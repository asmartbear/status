# Status

Command-line status update system

## Usage

```typescript
// A new manager with 10 threads, but doesn't start yet
const cm = new StatusManager(10);
// Start the status area, allocating blank space on the console
cm.start()
// Update any item, any time
cm.update(2, "my status")
// Logging still works -- gets "prepended" before the status area
console.log("This doesn't overwrite anything.")
// Stop the status area; subsequent logging goes under it
cm.stop()
```

## Development

Build:

```bash
npm run build
```

Unit tests:

```bash
npm run test
```

Unit tests, refreshed live:

```bash
npm run watch
```

Prepare for release (e.g. run tests and bump version number):

```bash
npm run release
```

Publish to npm:

```bash
npm publish
```
