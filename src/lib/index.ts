import { walk, type Node } from 'estree-walker';
import * as fs from 'fs';
import * as path from 'path';
import { parse, type AST } from 'svelte/compiler';
import * as crypto from 'crypto';

// Define SvelteNode type for Svelte AST nodes
interface SvelteNode {
	type: string;
	start: number;
	end: number;
	async?: boolean;
	id?: {
		name: string;
	};
	callee?: {
		name: string;
	};
	arguments: any[];
	specifiers: any[];
	[key: string]: any;
}

// Type definitions
interface PreprocessorResult {
	code: string;
}

interface PreprocessorContext {
	content: string;
	filename?: string;
}

interface ServerFunction {
	name: string;
	node: SvelteNode;
	start: number;
	end: number;
}

interface FunctionCall {
	start: number;
	end: number;
	arguments: {
		start: number;
		end: number;
	};
}

interface FunctionDetails {
	imports: string[];
	functionDefinition: string;
}

interface PathResult {
	apiPath: string;
	routePath: string;
}

interface ImportNode {
	start: number;
	end: number;
}

/**
 * SvelteKit preprocessor that transforms server-side functions into API endpoints
 */
export default function serverFunctions() {
	// Clean up any existing endpoints and create new ones at startup
	const endpointManager = new EndpointManager();
	endpointManager.cleanupEndpoints();
	endpointManager.scanAndCreateEndpoints();

	return {
		markup: ({ content, filename }: PreprocessorContext): PreprocessorResult => transformFile(content, filename),
		style: ({ content }: PreprocessorContext): PreprocessorResult => ({ code: content }),
		script: ({ content, filename }: PreprocessorContext): PreprocessorResult => transformFile(content, filename),
	};
}

/**
 * Handles file transformation, determining if it needs processing
 */
function transformFile(content: string, filename?: string): PreprocessorResult {
	try {
		// Skip non-svelte files or files in special directories
		if (isSkippableFile(filename) || !content.includes('async function server_')) {
			return { code: content };
		}

		const transformer = new ServerFunctionTransformer(content, filename);
		return { code: transformer.process() };
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.warn(`Warning: Error processing ${filename}`, errorMessage);
		return { code: content };
	}
}

/**
 * Checks if a file should be skipped from processing
 */
function isSkippableFile(filename?: string): boolean {
	if (!filename || !filename.endsWith('.svelte')) {
		return true;
	}

	const skipPaths = ['.svelte-kit', 'node_modules'];
	return skipPaths.some((skipPath) => filename.includes(skipPath));
}

/**
 * Manages API endpoints creation and cleanup
 */
class EndpointManager {
	private readonly apiDir: string;
	private readonly srcDir: string;

	constructor() {
		this.apiDir = path.join(process.cwd(), 'src', 'routes', 'api');
		this.srcDir = path.join(process.cwd(), 'src');
	}

	/**
	 * Removes previously generated API endpoints
	 */
	cleanupEndpoints(): void {
		if (!fs.existsSync(this.apiDir)) {
			return;
		}

		try {
			fs.readdirSync(this.apiDir)
				.filter((endpoint: string) => endpoint.startsWith('server_'))
				.forEach((endpoint: string) => {
					const endpointPath = path.join(this.apiDir, endpoint);
					if (fs.statSync(endpointPath).isDirectory()) {
						fs.rmSync(endpointPath, { recursive: true, force: true });
					}
				});
		} catch (error: unknown) {
			console.error('Error cleaning up endpoints:', error);
		}
	}

	/**
	 * Recursively scans Svelte files and creates API endpoints for server functions
	 */
	scanAndCreateEndpoints(): void {
		try {
			const files = fs.readdirSync(this.srcDir, { recursive: true }) as string[];

			files.forEach((file: string) => {
				if (file.endsWith('.svelte')) {
					const fullPath = path.join(this.srcDir, file);
					this.processFile(fullPath);
				}
			});
		} catch (error: unknown) {
			console.error('Error scanning for server functions:', error);
		}
	}

	/**
	 * Processes a single file to extract server functions
	 */
	processFile(filePath: string): void {
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			if (!content.includes('async function server_')) {
				return;
			}

			const ast = parse(content, { modern: true });
			const serverFunctions = AstUtils.findServerFunctions(ast);

			serverFunctions.forEach((func: ServerFunction) => {
				const { apiPath } = PathUtils.generatePaths(func.name, filePath);
				this.createEndpoint(apiPath, content, func);
			});
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			console.warn(`Warning: Could not process ${filePath}`, errorMessage);
		}
	}

	/**
	 * Creates or updates an API endpoint file for a server function
	 */
	createEndpoint(apiPath: string, content: string, serverFunc: ServerFunction): void {
		try {
			const { imports, functionDefinition } = AstUtils.extractFunctionDetails(content, serverFunc);
			const apiContent = this.generateApiContent(functionDefinition, serverFunc.name, imports);

			// Ensure directory exists
			fs.mkdirSync(path.dirname(apiPath), { recursive: true });

			// Only write if file doesn't exist or content has changed
			if (!fs.existsSync(apiPath) || fs.readFileSync(apiPath, 'utf-8') !== apiContent) {
				fs.writeFileSync(apiPath, apiContent);
			}
		} catch (error: unknown) {
			console.error(`Error creating endpoint for ${serverFunc.name}:`, error);
		}
	}

	/**
	 * Generates the API endpoint file content with proper TypeScript types
	 */
	generateApiContent(functionDefinition: string, functionName: string, imports: string[]): string {
		return `${imports.join('\n')}

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    ${functionDefinition}
    const payload: Record<string, unknown> = await request.json();
    const args = Object.values(payload) as Parameters<typeof ${functionName}>;
    const result = await ${functionName}(...args);
    return json(result);
};`;
	}
}

/**
 * Handles the transformation of Svelte file content
 */
class ServerFunctionTransformer {
	private content: string;
	private readonly filename?: string;
	private ast: AST.Root;

	constructor(content: string, filename?: string) {
		this.content = content;
		this.filename = filename;
		this.ast = parse(content, { modern: true });
	}

	/**
	 * Process the file content to transform server functions
	 */
	process(): string {
		const serverFunctions = AstUtils.findServerFunctions(this.ast);

		// If no server functions are found, return the original content
		if (serverFunctions.length === 0) {
			return this.content;
		}

		// Sort in reverse order to avoid affecting positions when modifying the content
		serverFunctions
			.sort((a: ServerFunction, b: ServerFunction) => b.start - a.start)
			.forEach((func: ServerFunction) => {
				const { routePath } = PathUtils.generatePaths(func.name, this.filename);
				this.transformServerFunction(func, routePath);
			});

		return this.content;
	}

	/**
	 * Transform a single server function and its calls
	 */
	transformServerFunction(serverFunc: ServerFunction, routePath: string): void {
		// First, find all calls to the server function
		const calls = AstUtils.findFunctionCalls(this.ast, serverFunc.name);

		// Transform all calls to fetch (in reverse order to maintain positions)
		calls
			.sort((a: FunctionCall, b: FunctionCall) => b.start - a.start)
			.forEach((call: FunctionCall) => {
				const argsText = this.content.slice(call.arguments.start, call.arguments.end);
				const fetchCall = this.generateFetchCall(routePath, argsText);
				this.content = this.content.slice(0, call.start) + fetchCall + this.content.slice(call.end);
			});

		// Remove the original function definition
		this.content =
			this.content.slice(0, serverFunc.start).trimEnd() +
			'\n' +
			this.content.slice(serverFunc.end).trimStart();

		// Update the AST and clean up unused imports
		this.cleanupUnusedImports();
	}

	/**
	 * Generates a fetch call that replaces the original function call
	 */
	generateFetchCall(routePath: string, params: string): string {
		const payloadStr = params.trim()
			? `{${params
				.split(',')
				.map((p: string, i: number) => `"${i}": ${p.trim()}`)
				.join(',')}}`
			: '{}';

		return `fetch('/api/${routePath}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(${payloadStr})
    }).then(response => {
        if (!response.ok) throw new Error('API call failed: ' + response.statusText);
        return response.json();
    })`;
	}

	/**
	 * Clean up imports that are no longer used after removing server functions
	 */
	cleanupUnusedImports(): void {
		try {
			// Re-parse the modified content to get updated AST
			const updatedAst = parse(this.content, { modern: true });
			const usedIdentifiers = AstUtils.collectUsedIdentifiers(updatedAst);
			const unusedImports = AstUtils.findUnusedImports(updatedAst, usedIdentifiers);

			// Remove unused imports (in reverse order to maintain positions)
			unusedImports
				.sort((a: ImportNode, b: ImportNode) => b.start - a.start)
				.forEach((importNode: ImportNode) => {
					this.content =
						this.content.slice(0, importNode.start).trimEnd() +
						'\n' +
						this.content.slice(importNode.end).trimStart();
				});
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			console.warn('Warning: Error cleaning up imports', errorMessage);
		}
	}
}

/**
 * Utility functions for AST operations
 */
class AstUtils {
	/**
	 * Finds all async functions that start with 'server_'
	 */
	static findServerFunctions(ast: AST.Root): ServerFunction[] {
		const functions: ServerFunction[] = [];

		if (!ast.instance) return functions;

		walk(ast.instance.content, {
			enter(node: any) {
				if (
					node.type === 'FunctionDeclaration' &&
					node.async &&
					node.id?.name?.startsWith('server_')
				) {
					functions.push({
						name: node.id.name,
						node: node as SvelteNode,
						start: node.start,
						end: node.end,
					});
				}
			},
		});

		return functions;
	}

	/**
	 * Finds all calls to a specific function
	 */
	static findFunctionCalls(ast: AST.Root, functionName: string): FunctionCall[] {
		const calls: FunctionCall[] = [];

		// Walk through all parts of the AST
		if (ast.fragment) {
			walk(ast.fragment as unknown as Node, {
				enter(node: Node) {
					if (node.type === 'CallExpression' && (node as any).callee?.name === functionName) {
						calls.push({
							start: (node as any).start,
							end: (node as any).end,
							arguments: {
								start: (node as any).arguments[0]?.start || (node as any).end - 1,
								end: (node as any).arguments[(node as any).arguments.length - 1]?.end || (node as any).end - 1,
							},
						});
					}
				},
			});
		}

		if (ast.instance) {
			walk(ast.instance.content as Node, {
				enter(node: Node) {
					if (node.type === 'CallExpression' && (node as any).callee?.name === functionName) {
						calls.push({
							start: (node as any).start,
							end: (node as any).end,
							arguments: {
								start: (node as any).arguments[0]?.start || (node as any).end - 1,
								end: (node as any).arguments[(node as any).arguments.length - 1]?.end || (node as any).end - 1,
							},
						});
					}
				},
			});
		}

		return calls;
	}

	/**
	 * Extracts the function definition and its required imports
	 */
	static extractFunctionDetails(content: string, serverFunc: ServerFunction): FunctionDetails {
		const ast = parse(content, { modern: true });
		const relevantImports = new Set<string>();
		const usedIdentifiers = new Set<string>();

		// Find all identifiers used in the function
		walk(serverFunc.node as any, {
			enter(node: any) {
				if (node.type === 'Identifier') {
					usedIdentifiers.add(node.name);
				}
			},
		});

		// Find imports that contain any of the used identifiers
		if (ast.instance) {
			walk(ast.instance.content, {
				enter(node: any) {
					if (node.type === 'ImportDeclaration') {
						const importedNames = node.specifiers.map((specifier: any) => specifier.local.name);
						if (importedNames.some((name: string) => usedIdentifiers.has(name))) {
							relevantImports.add(content.slice(node.start, node.end));
						}
					}
				},
			});
		}

		return {
			imports: Array.from(relevantImports),
			functionDefinition: content.slice(serverFunc.start, serverFunc.end),
		};
	}

	/**
	 * Collects all identifiers used in the instance script
	 */
	static collectUsedIdentifiers(ast: AST.Root): Set<string> {
		const identifiers = new Set<string>();

		if (!ast.instance) return identifiers;

		walk(ast.instance.content, {
			enter(node: any, parent?: any) {
				// Skip import declarations and their children
				if (node.type === 'ImportDeclaration' || (parent && parent.type === 'ImportDeclaration')) {
					return this.skip();
				}
				if (node.type === 'Identifier') {
					identifiers.add(node.name);
				}
			},
		});

		return identifiers;
	}

	/**
	 * Finds imports that are no longer used
	 */
	static findUnusedImports(ast: AST.Root, usedIdentifiers: Set<string>): ImportNode[] {
		const unusedImports: ImportNode[] = [];

		if (!ast.instance) return unusedImports;

		walk(ast.instance.content, {
			enter(node: any) {
				if (node.type === 'ImportDeclaration') {
					const allSpecifiersUnused = node.specifiers.every(
						(specifier: any) => !usedIdentifiers.has(specifier.local.name),
					);
					if (allSpecifiersUnused) {
						unusedImports.push({
							start: node.start,
							end: node.end,
						});
					}
				}
			},
		});

		return unusedImports;
	}
}

/**
 * Utilities for path generation and management
 */
class PathUtils {
	/**
	 * Generates unique API paths for server functions
	 */
	static generatePaths(functionName: string, filename?: string): PathResult {
		const relativePath = filename
			? path.relative(path.join(process.cwd(), 'src'), path.normalize(filename)).replace(/\\/g, '/')
			: 'unknown';

		const str = `${relativePath}:${functionName}`;
		const hash = crypto.createHash('sha256').update(str).digest('base64url').slice(0, 8);
		const uniquePath = `${functionName}_${hash}`;

		return {
			apiPath: path.join(process.cwd(), 'src', 'routes', 'api', uniquePath, '+server.ts'),
			routePath: uniquePath,
		};
	}
}
