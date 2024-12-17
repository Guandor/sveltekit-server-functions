import { walk } from 'estree-walker';
import fs from 'fs';
import path from 'path';
import { parse } from 'svelte/compiler';

export default function serverFunctions() {
	cleanupEndpoints();
	// Run this once at startup, before SvelteKit initializes
	const srcDir = path.join(process.cwd(), 'src');
	scanAndCreateEndpoints(srcDir);
	return {
		markup: handleFile,
		style: ({ content }) => ({ code: content }),
		script: handleFile
	};
}

// Recursively scans Svelte files and creates API endpoints for server functions
function scanAndCreateEndpoints(dir) {
	const files = fs.readdirSync(dir, { recursive: true });

	files.forEach((file) => {
		if (file.endsWith('.svelte')) {
			const fullPath = path.join(dir, file);
			const content = fs.readFileSync(fullPath, 'utf-8');
			try {
				const ast = parse(content);
				const serverFunctions = findFunctions(ast);

				serverFunctions.forEach((func) => {
					const { apiPath } = generatePaths(func.name, fullPath);
					createEndpoint(apiPath, content, func);
				});
			} catch {
				/* Handle silently */
			}
		}
	});
}

function handleFile({ content, filename }) {
	try {
		if (isSkippable(filename)) {
			return { code: content };
		}

		// Skip if no server functions present
		if (!content.includes('async function server_')) {
			return { code: content };
		}

		const result = processFunctions(content, filename);
		return result;
	} catch {
		return { code: content };
	}
}

function isSkippable(filename) {
	return (
		['.svelte-kit', 'node_modules'].some((dir) => filename.includes(dir)) ||
		!filename.endsWith('.svelte')
	);
}

// Removes previously generated API endpoints
function cleanupEndpoints() {
	const apiDir = path.join(process.cwd(), 'src', 'routes', 'api');
	if (!fs.existsSync(apiDir)) {
		return;
	}

	fs.readdirSync(apiDir)
		.filter((endpoint) => endpoint.startsWith('server_'))
		.forEach((endpoint) => {
			const endpointPath = path.join(apiDir, endpoint);
			if (fs.statSync(endpointPath).isDirectory()) {
				fs.rmSync(endpointPath, { recursive: true, force: true });
			}
		});
}

import crypto from 'crypto';

// Generates unique API paths using SHA-256 hashing to prevent collisions
function generatePaths(functionName, filename) {
	const relativePath = filename
		? path.relative(path.join(process.cwd(), 'src'), path.normalize(filename)).replace(/\\/g, '/')
		: 'unknown';

	const str = `${relativePath}:${functionName}`;
	const hash = crypto.createHash('sha256').update(str).digest('base64url').slice(0, 8);
	const uniquePath = `${functionName}_${hash}`;

	return {
		apiPath: path.join(process.cwd(), 'src', 'routes', 'api', uniquePath, '+server.ts'),
		routePath: uniquePath
	};
}

function transformCode(content, serverFunc, routePath) {
	// First, collect all calls to the server function
	const freshAst = parse(content);
	const calls = findCalls(freshAst, serverFunc.name);

	let transformedContent = content;

	// Transform all calls to fetch
	calls
		.sort((a, b) => b.start - a.start)
		.forEach((call) => {
			const fetchCall = generateFetchCall(
				routePath,
				transformedContent.slice(call.arguments.start, call.arguments.end)
			);

			transformedContent =
				transformedContent.slice(0, call.start) + fetchCall + transformedContent.slice(call.end);
		});

	// Remove the original function definition
	transformedContent =
		transformedContent.slice(0, serverFunc.start).trimEnd() +
		'\n' +
		transformedContent.slice(serverFunc.end).trimStart();

	// Now that the function is removed, parse again and check for truly used identifiers
	const finalAst = parse(transformedContent);
	const usedIdentifiers = collectUsedIdentifiers(finalAst);

	const unusedImports = findUnusedImports(finalAst, usedIdentifiers);

	// Remove unused imports
	unusedImports
		.sort((a, b) => b.start - a.start)
		.forEach((importNode) => {
			transformedContent =
				transformedContent.slice(0, importNode.start).trimEnd() +
				'\n' +
				transformedContent.slice(importNode.end).trimStart();
		});

	return transformedContent;
}

// Generates a fetch call that matches the original function signature
function generateFetchCall(routePath, params) {
	const payloadStr = params.trim()
		? `{${params
				.split(',')
				.map((p, i) => `"${i}": ${p.trim()}`)
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

// Generates the API endpoint file content with proper TypeScript types
function generateApiContent(functionDefinition, functionName, imports) {
	return `${imports.join('\n')}

import { json } from '@sveltejs/kit';

export async function POST({ request }) {
    ${functionDefinition}
    const payload: Record<string, unknown> = await request.json();
    const args = Object.values(payload) as Parameters<typeof ${functionName}>;
    const result = await ${functionName}(...args);
    return json(result);
}`;
}

// Main processing function that handles the transformation of server functions
function processFunctions(content, filename) {
	const ast = parse(content);
	const serverFunctions = findFunctions(ast);

	serverFunctions
		.sort((a, b) => b.start - a.start)
		.forEach((func) => {
			const { apiPath, routePath } = generatePaths(func.name, filename);
			createEndpoint(apiPath, content, func);
			content = transformCode(content, func, routePath);
			parse(content);
		});

	return { code: content };
}

// Finds all async functions that start with 'server_'
function findFunctions(ast) {
	const functions = [];
	if (ast.instance) {
		walk(ast.instance.content, {
			enter(node) {
				if (
					node.type === 'FunctionDeclaration' &&
					node.async &&
					node.id?.name?.startsWith('server_')
				) {
					functions.push({
						name: node.id.name,
						node,
						start: node.start,
						end: node.end
					});
				}
			}
		});
	}
	return functions;
}

// Creates or updates the API endpoint file
function createEndpoint(apiPath, content, serverFunc) {
	const { imports, functionDefinition } = extractFunctionDetails(content, serverFunc);
	const apiContent = generateApiContent(functionDefinition, serverFunc.name, imports);

	fs.mkdirSync(path.dirname(apiPath), { recursive: true });

	if (!fs.existsSync(apiPath) || fs.readFileSync(apiPath, 'utf-8') !== apiContent) {
		fs.writeFileSync(apiPath, apiContent);
	}
}

// Extracts the function definition and its required imports
function extractFunctionDetails(content, serverFunc) {
	const ast = parse(content);
	const relevantImports = new Set();
	const usedIdentifiers = new Set();

	// Find all identifiers used in the function
	walk(serverFunc.node, {
		enter(node) {
			if (node.type === 'Identifier') usedIdentifiers.add(node.name);
		}
	});

	// Find imports that contain any of the used identifiers
	if (ast.instance) {
		walk(ast.instance.content, {
			enter(node) {
				if (node.type === 'ImportDeclaration') {
					const importedNames = node.specifiers.map((specifier) => specifier.local.name);
					if (importedNames.some((name) => usedIdentifiers.has(name))) {
						relevantImports.add(content.slice(node.start, node.end));
					}
				}
			}
		});
	}

	return {
		imports: Array.from(relevantImports),
		functionDefinition: content.slice(serverFunc.start, serverFunc.end)
	};
}

// Finds all calls to a specific function in the AST
function findCalls(ast, functionName) {
	const calls = [];
	walk(ast, {
		enter(node) {
			if (node.type === 'CallExpression' && node.callee?.name === functionName) {
				calls.push({
					start: node.start,
					end: node.end,
					arguments: {
						start: node.arguments[0]?.start || node.end - 1,
						end: node.arguments[node.arguments.length - 1]?.end || node.end - 1
					}
				});
			}
		}
	});
	return calls;
}

// Helper function to find imports that are no longer used
function findUnusedImports(ast, usedIdentifiers) {
	const unusedImports = [];
	if (ast.instance) {
		walk(ast.instance.content, {
			enter(node) {
				if (node.type === 'ImportDeclaration') {
					const allSpecifiersUnused = node.specifiers.every(
						(specifier) => !usedIdentifiers.has(specifier.local.name)
					);
					if (allSpecifiersUnused) {
						unusedImports.push({
							start: node.start,
							end: node.end
						});
					}
				}
			}
		});
	}
	return unusedImports;
}

function collectUsedIdentifiers(ast) {
	const identifiers = new Set();
	if (ast.instance) {
		walk(ast.instance.content, {
			enter(node, parent) {
				// Skip import declarations and their children
				if (node.type === 'ImportDeclaration' || (parent && parent.type === 'ImportDeclaration')) {
					return this.skip();
				}
				if (node.type === 'Identifier') {
					identifiers.add(node.name);
				}
			}
		});
	}
	return identifiers;
}
