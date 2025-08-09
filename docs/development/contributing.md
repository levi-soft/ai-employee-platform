# Contributing Guidelines

## 🤝 How to Contribute

### Development Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes following our coding standards
4. Write or update tests for your changes
5. Run the test suite: `yarn test`
6. Commit with conventional commits: `git commit -m "feat: add amazing feature"`
7. Push to your branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Coding Standards

#### TypeScript Guidelines:

- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use explicit return types for functions
- Avoid `any` - use proper typing

#### Code Style:

- Follow Prettier configuration
- Use ESLint rules consistently
- Follow naming conventions:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and components
  - `UPPER_CASE` for constants
  - `kebab-case` for file names

#### Git Commit Messages:

Follow conventional commits format:

```
type(scope): subject

body

footer
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

#### Pull Request Guidelines:

- Include clear description of changes
- Reference related issues
- Ensure CI passes
- Request review from maintainers
- Keep PRs focused and reasonably sized

### Testing Requirements:

- Write unit tests for new functions/methods
- Add integration tests for new API endpoints
- Update existing tests when modifying functionality
- Maintain test coverage above 70%

### Documentation:

- Update API documentation for new endpoints
- Add or update JSDoc comments for new functions
- Update README files when adding new features
- Include examples in documentation
