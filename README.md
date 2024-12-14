# SvelteKit Server Functions Preprocessor

This is the missing SvelteKit server functions library. _(Well, sort of, it's more of a proof of concept. **Not production ready.**)_

A SvelteKit preprocessor that automatically transforms server-side functions into API endpoints, enabling seamless client-server communication in your SvelteKit applications.

```javascript
async function server_getData(id) {
  // This code runs on the server
  const data = await db.query("SELECT FROM items WHERE id = ?", [id]);
  return data;
}
// Use the function as if it were local
const data = await server_getData(123);
```

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Function Requirements](#function-requirements)
- [Example](#example)
- [Security Considerations](#security-considerations)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🚀 Automatically generates API endpoints from server functions
- 🔄 Transforms server function calls into fetch requests
- 🔒 Secure function isolation with unique endpoint paths
- 📦 Zero runtime configuration needed
- 🔍 Intelligent import handling
- ⚡ TypeScript support out of the box - full type safety

## Installation

```bash
npm install sveltekit-server-functions
```

## Usage

1. Add the preprocessor to your `svelte.config.js`:

```javascript
import serverFunctions from "sveltekit-server-functions";
export default {
  preprocess: [serverFunctions(), vitePreprocess()],
};
```

2. Create server functions in your Svelte components by prefixing them with `server_`:

```javascript
async function server_getData(id) {
  // This code runs on the server
  const data = await db.query("SELECT FROM items WHERE id = ?", [id]);
  return data;
}
// Use the function as if it were local
const data = await server_getData(123);
```

The preprocessor will automatically:

- Create an API endpoint for the server function
- Transform the function call into a fetch request
- Handle data serialization and error handling

## How It Works

1. During build time, the preprocessor scans your Svelte files for functions prefixed with `server_`
2. For each server function, it:
   - Creates a unique API endpoint in your project's `src/routes/api` directory
   - Transforms the original function call into a fetch request
   - Preserves all necessary imports and types
3. The generated API endpoints handle:
   - Request validation
   - Parameter parsing
   - Response serialization
   - Error handling

## Function Requirements

- Must be async functions
- Must be prefixed with `server_`
- Must be defined in the script section of a Svelte component
- Should return JSON-serializable data

## Example

```svelte
<script>
import { db } from '$lib/database';

// Define a server function to create a user
async function server_createUser(username, email) {
  // This function runs on the server
  const user = await db.users.create({
    username,
    email,
    createdAt: new Date()
  });
  return user; // Return the created user
}

// Handle form submission
async function handleSubmit() {
  try {
    // Call the server function as if it were local
    const newUser = await server_createUser('john_doe', 'john@example.com');
    console.log('User created:', newUser);
  } catch (error) {
    console.error('Failed to create user:', error);
  }
}
</script>

<!-- Button to trigger user creation -->
<button on:click={handleSubmit}>Create User</button>
```

## Security Considerations

- Server functions are only executed on the server
- API endpoints use unique hashed paths to prevent collisions
- Request validation is automatically handled
- Error messages are sanitized before being sent to the client

## Limitations

- Server functions must return JSON-serializable data
- Circular dependencies in server functions are not supported
- Components can only call the server functions that are declared in the same file.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this package in your projects!
