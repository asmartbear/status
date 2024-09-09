import * as readline from 'readline';

/**
 * Loads row and column from the terminal.
 */
function getCursorPosition(): Promise<{ row: number; column: number }> {
  return new Promise((resolve, reject) => {
    // Set terminal to raw mode to capture stdin without waiting for Enter
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Request the cursor position from the terminal
    process.stdout.write('\u001b[6n');

    // Read the response from stdin
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on('line', (input: string) => {
      // Expected format: \u001b[{row};{column}R
      const match = /\[(\d+);(\d+)R/.exec(input);
      if (match) {
        const row = parseInt(match[1], 10);
        const column = parseInt(match[2], 10);
        resolve({ row, column });
      } else {
        reject(new Error('Failed to parse cursor position'));
      }

      rl.close();
      process.stdin.setRawMode(false);
      process.stdin.pause();
    });
  });
}

export class StatusManager<K extends number | string> {
  /**
   * Map keys to status messages
   */
  private statusLines = new Map<K, string>()

  /**
   * Map keys to line-numbers in our block
   */
  private lineNumbers = new Map<K, number>()

  /**
   * Flag that means we need to redraw the whole block
   */
  private dirty: boolean = false;

  private originalLog: (...args: any[]) => void;
  private originalError: (...args: any[]) => void;
  private originalWarn: (...args: any[]) => void;

  constructor() {
    this.originalLog = console.log;
    this.originalError = console.error;
    this.originalWarn = console.warn;
  }

  /**
   * Current number of lines in our status block.
   */
  private get numLines(): number {
    return this.statusLines.size
  }

  /**
   * Gets an array of keys, in the order that they map to line numbers
   */
  private get keys(): K[] {
    return Array.from(this.lineNumbers.keys())
  }

  /**
   * Converts a block line number to a terminal row number.
   */
  private getTerminalRow(line: number): number {
    return process.stdout.rows - line - 1
  }

  /**
   * Move cursor to a specific line relative to the top of the block.
   */
  private moveCursorToLine(line: number, column: number = 0): void {
    const row = this.getTerminalRow(line)
    process.stdout.write(`\u001b[${row};${column + 1}H`);
  }

  /**
   * Clear the current line.
   */
  private clearLine(): void {
    process.stdout.write('\u001b[2K');
  }

  /**
   * Clear all lines in the block
   */
  private clearLines(): void {
    for (var line = this.numLines; --line >= 0;) {
      this.moveCursorToLine(line)
      this.clearLine()
    }
  }

  /**
   * Writes a line, assuming the cursor is already on the right line.
   */
  private writeStatusHere(key: K, offset: number = 0) {
    if (offset == 0) {
      this.clearLine();
    }
    const truncatedContent = (this.statusLines.get(key) || '').substring(offset, (process.stdout.columns || 80) - 1);
    process.stdout.write(truncatedContent); // Write the updated content
    if (offset > 0) {
      process.stdout.write('\u001b[0K');   // clear remainder of the line
    }
  }

  /**
   * Redraw the entire block.
   * 
   * @param fromThisSpot if true, assume the cursor is already in the right spot, else move to the right spot
   */
  private redrawAllLines(fromThisSpot: boolean): void {

    // Ensure the space exists
    if (!fromThisSpot) {
      this.moveCursorToTop();
    }
    for (let i = this.numLines; --i >= 0;) {
      process.stdout.write("\n")
    }

    // Redraw the content
    for (var key of this.keys) {
      this.updateSingleLine(key, 0)
    }
    this.dirty = false; // Clear the dirty flag after redrawing
  }

  /**
   * Update just one of the lines.
   */
  private updateSingleLine(key: K, offset: number): void {
    const line = this.lineNumbers.get(key)
    if (line !== undefined) {
      this.moveCursorToLine(line, offset);
      this.writeStatusHere(key, offset)
    }
  }

  /**
   * Move cursor to the bottom of the block.
   */
  private moveCursorToBottom(): void {
    process.stdout.write(`\u001b[${process.stdout.rows};1H`);
  }

  /**
   * Move cursor to the top of the block.
   */
  private moveCursorToTop(): void {
    this.moveCursorToLine(this.numLines - 1)
  }

  /**
   * Update a single line, which will redraw everything if other console activity happened.
   */
  update(key: K, content: string): void {
    var redrawFromThisSpot = true

    // Set the line content, and create a new line if needed
    const prev = this.statusLines.get(key);
    let offset = 0
    if (prev) {
      // If status is identical, do nothing
      if (prev == content) return
      // Check for common prefix, as this means fewer console operations
      offset = getCommonPrefixLength(prev, content)
    } else {
      // If we already direct, redraw from this spot to make room
      if (this.dirty) {
        this.redrawAllLines(true)
      }
      // Set the data
      const lineNumber = this.numLines
      this.lineNumbers.set(key, lineNumber)    // create the new line number
      // Add a new line to the bottom to make room
      this.moveCursorToBottom()   // physically add a new line
      process.stdout.write("\n")
      this.dirty = true   // redraw everything
      redrawFromThisSpot = false    // we've made the space but we're in the wrong position
    }
    this.statusLines.set(key, content)
    // const maxOffset = Math.min(content.length, prev.length)
    // for (; offset < maxOffset; ++offset) {
    //   if (content[offset] != prev[offset]) {
    //     break
    //   }
    // }

    // If the screen is dirty, do a full redraw, otherwise update just the one line
    if (this.dirty) {
      this.redrawAllLines(redrawFromThisSpot);
    } else {
      this.updateSingleLine(key, offset);
    }
    this.moveCursorToBottom()
  }

  /**
   * Begin the process with blank status lines.
   */
  start(): void {

    // Trap the console functions
    console.log = this.interceptConsole(this.originalLog);
    console.error = this.interceptConsole(this.originalError);
    console.warn = this.interceptConsole(this.originalWarn);
  }

  /**
   * Stop the process, positioning the console for further updates.
   */
  stop(): void {
    console.log = this.originalLog;
    console.error = this.originalError;
    console.warn = this.originalWarn;

    // Move the cursor to the bottom of the block to resume normal output
    this.moveCursorToBottom();
  }

  /**
   * Intercepts the console function, prepends log output, and marks the screen as dirty
   */
  private interceptConsole(originalFn: (...args: any[]) => void) {
    return (...args: any[]): void => {
      // Clear out the block to make clean space for the log
      if (!this.dirty) {
        this.clearLines();
        this.moveCursorToTop()
        this.dirty = true;      // will need to redraw when this is over
      }
      // Print the intercepted log message
      originalFn.apply(console, args);
    };
  }
}

/**
 * Gets the number of characters that `a` and `b` have in common at their start.
 * It can be zero, or can be up to the length of the shorter string.
 */
export function getCommonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  var i = 0
  for (; i < n; ++i) {
    if (a[i] != b[i]) break
  }
  return i
}

/////////////////////////////////////////////////
// Example usage

// function sleep(ms: number): Promise<void> {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// (async () => {
//   const N_LINES = 5
//   const cm = new StatusManager<number>();

//   cm.start()

//   for (var i = 1; i <= 30; ++i) {
//     const line = Math.floor(Math.random() * N_LINES)
//     if (i % 5 == 0) {
//       console.log("one thing")
//       console.log("and another")
//     }
//     cm.update(line, `For line ${line} at ${new Date().toLocaleTimeString()}: ${i}`);
//     await sleep(200)
//   }

//   cm.stop()

// })().then(() => console.log("Done."))