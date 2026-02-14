# 5IVE VM Project

A basic project built with 5IVE VM.

## Getting Started

### Prerequisites

- Node.js 18+
- 5IVE CLI: `npm install -g @5ive-tech/cli`

### Building

```bash
# Compile the project
npm run build

# Compile with optimizations
npm run build:release

# Compile with debug information
npm run build:debug
```

### Testing

#### Discover and Run Tests

5IVE CLI automatically discovers test functions from your `.v` files:

```bash
# Run all tests
npm test

# Run with watch mode for continuous testing
5ive test --watch

# Run specific tests by filter
5ive test --filter "test_add"

# Run with verbose output
5ive test --verbose

# Run with JSON output for CI/CD
5ive test --format json
```

#### Writing Tests

Test functions in your `.v` files use the `pub test_*` naming convention and include `@test-params` comments:

```v
// @test-params 10 20 30
pub test_add(a: u64, b: u64) -> u64 {
    return a + b;
}

// @test-params 5 2 10
pub test_multiply(a: u64, b: u64) -> u64 {
    return a * b;
}
```

The `@test-params` comment specifies the parameters to pass and expected result. The test runner will:
1. Discover test functions automatically
2. Compile the source file
3. Execute with the specified parameters
4. Validate the result matches

### Development

```bash
# Watch for changes and auto-compile
npm run watch
```

### Deployment

```bash
# Deploy to devnet
npm run deploy
```

## Project Structure

- `src/` - 5IVE VM source files (.v)
- `tests/` - Test files (.v files with test_* functions)
- `build/` - Compiled bytecode
- `docs/` - Documentation
- `five.toml` - Project configuration

## Multi-File Projects

If your project uses multiple modules with `use` or `import` statements, 5IVE CLI automatically handles:

```bash
# Automatic discovery of imported modules
5ive compile src/main.v --auto-discover

# Or use the build command which respects five.toml configuration
5ive build
```

## Learn More

- [5IVE VM Documentation](https://five-vm.dev)
- [5IVE VM GitHub](https://github.com/five-vm)
- [Multi-File Compilation Guide](./docs/multi-file.md)
- [Examples](./examples)

## License

MIT
