# Status

Command-line status update system

## Usage

```typescript
// A new manager. Nothing happens yet.
const cm = new StatusManager();
// Start the status area, though still nothing is printed
cm.start()
// Update items by keys that you invent.  As you add unqiue ones, they are added
// and console space is allocated without overwriting existing console messages.
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
