# General Code Style Principles

This document outlines general coding principles that apply across all languages and frameworks used in this project.

## Readability

- Code should be easy to read and understand by humans
- Avoid overly clever or obscure constructs
- Prefer explicit over implicit behavior
- Use meaningful names that reveal intent

## Consistency

- Follow existing patterns in the codebase
- Maintain consistent formatting, naming, and structure
- When in doubt, match the style of surrounding code
- Use automated formatters to enforce consistency

## Simplicity

- Prefer simple solutions over complex ones
- Break down complex problems into smaller, manageable parts
- Avoid premature optimization
- Write code that is easy to delete, not easy to extend

## Maintainability

- Write code that is easy to modify and extend
- Minimize dependencies and coupling
- Keep functions and classes focused (Single Responsibility)
- Prefer composition over inheritance

## Documentation

- Document *why* something is done, not just *what*
- Keep documentation up-to-date with code changes
- Use self-documenting code where possible
- Add comments for non-obvious business logic

## Error Handling

- Handle errors explicitly, don't ignore them
- Provide meaningful error messages
- Fail fast and fail loudly in development
- Gracefully degrade in production

## Testing

- Write tests alongside code, not after
- Test behavior, not implementation
- Keep tests readable and maintainable
- Aim for >80% coverage on new code
