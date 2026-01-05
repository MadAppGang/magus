# JavaScript Style Guide

This document summarizes key rules and best practices for JavaScript development.

## 1. Source File Basics

- **File Naming:** All lowercase, with hyphens (`-`) or underscores (`_`). Extension: `.js` or `.mjs`
- **File Encoding:** UTF-8
- **Indentation:** 2 spaces. Tabs are forbidden

## 2. Source File Structure

- Use ES modules (`import`/`export`)
- **Exports:** Prefer named exports over default exports
- **Imports:** Group and order imports:
  1. External packages
  2. Internal modules
  3. Types (if using TypeScript)

### Example

```javascript
// External
import express from 'express';
import { Router } from 'express';

// Internal
import { userService } from './services/user-service.js';
import { validateInput } from './utils/validation.js';
```

## 3. Formatting

- **Braces:** Required for all control structures, even single-line blocks
- **Brace Style:** K&R style (opening brace on same line)
- **Semicolons:** Every statement must end with a semicolon
- **Column Limit:** 80-100 characters
- **Line-wrapping:** Indent continuation lines by 2 spaces
- **Trailing Commas:** Use trailing commas in arrays and objects

### Example

```javascript
// Good
if (condition) {
  doSomething();
}

const config = {
  name: 'app',
  version: '1.0.0',
  enabled: true,
};

// Bad
if (condition)
  doSomething();
```

## 4. Language Features

### Variables

- Use `const` by default
- Use `let` only if reassignment is needed
- **Never use `var`**

### Arrays

```javascript
// Good
const items = [1, 2, 3];
const copy = [...items];

// Bad
const items = new Array(1, 2, 3);
```

### Objects

```javascript
// Good - shorthand properties and methods
const name = 'user';
const user = {
  name,
  greet() {
    return `Hello, ${this.name}`;
  },
};

// Bad
const user = {
  name: name,
  greet: function() {
    return 'Hello, ' + this.name;
  },
};
```

### Functions

- Prefer arrow functions for callbacks
- Use function declarations for named functions
- Use default parameters instead of conditionals

```javascript
// Good
const double = (x) => x * 2;
items.map((item) => item.name);

function calculateTotal(items, tax = 0) {
  return items.reduce((sum, item) => sum + item.price, 0) * (1 + tax);
}

// Bad
items.map(function(item) {
  return item.name;
});
```

### Strings

- Use single quotes (`'`) for strings
- Use template literals for interpolation and multi-line strings

```javascript
// Good
const greeting = 'Hello';
const message = `Hello, ${name}!`;
const multiline = `
  Line 1
  Line 2
`;

// Bad
const greeting = "Hello";
const message = 'Hello, ' + name + '!';
```

### Control Structures

- Prefer `for...of` for iterating arrays
- Use `for...in` only for object properties
- Always use `===` and `!==` (strict equality)

```javascript
// Good
for (const item of items) {
  process(item);
}

if (value === null) {
  handleNull();
}

// Bad
for (let i = 0; i < items.length; i++) {
  process(items[i]);
}

if (value == null) {
  handleNull();
}
```

## 5. Disallowed Features

- `with` keyword
- `eval()` or `Function(...string)`
- Modifying builtin prototypes (`Array.prototype.custom = ...`)
- Relying on Automatic Semicolon Insertion

## 6. Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | UpperCamelCase | `UserService` |
| Functions | lowerCamelCase | `getUserById` |
| Methods | lowerCamelCase | `calculateTotal` |
| Constants | CONSTANT_CASE | `MAX_RETRIES` |
| Variables | lowerCamelCase | `userName` |
| Files | kebab-case | `user-service.js` |

## 7. Error Handling

```javascript
// Good - specific error handling
try {
  const data = await fetchData();
  return processData(data);
} catch (error) {
  if (error instanceof NetworkError) {
    logger.warn('Network issue, retrying...', { error });
    return retry();
  }
  logger.error('Unexpected error', { error });
  throw error;
}

// Bad - swallowing errors
try {
  await fetchData();
} catch (error) {
  // Silent failure
}
```

## 8. Async/Await

- Prefer `async/await` over raw Promises
- Use `Promise.all()` for parallel operations
- Always handle rejections

```javascript
// Good
async function loadUserData(userId) {
  const [user, preferences] = await Promise.all([
    fetchUser(userId),
    fetchPreferences(userId),
  ]);
  return { user, preferences };
}

// Bad - sequential when could be parallel
async function loadUserData(userId) {
  const user = await fetchUser(userId);
  const preferences = await fetchPreferences(userId);
  return { user, preferences };
}
```

## 9. JSDoc Comments

```javascript
/**
 * Calculates the total price including tax.
 * @param {Array<{price: number}>} items - List of items with prices
 * @param {number} [taxRate=0] - Tax rate as decimal (e.g., 0.1 for 10%)
 * @returns {number} Total price including tax
 * @throws {Error} If items array is empty
 */
function calculateTotal(items, taxRate = 0) {
  if (items.length === 0) {
    throw new Error('Items array cannot be empty');
  }
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 + taxRate);
}
```

**BE CONSISTENT.** When editing code, match the existing style.
