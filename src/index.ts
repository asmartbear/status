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

export class StatusManager {
  private lines: string[] = [];
  private readonly totalLines: number;
  private dirty: boolean = false; // Flag to indicate if the screen needs a full redraw

  private originalLog: (...args: any[]) => void;
  private originalError: (...args: any[]) => void;
  private originalWarn: (...args: any[]) => void;

  constructor(totalLines: number) {
    this.totalLines = totalLines;
    this.originalLog = console.log;
    this.originalError = console.error;
    this.originalWarn = console.warn;
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
  private moveCursorToLine(line: number): void {
    const row = this.getTerminalRow(line)
    const column = 1
    process.stdout.write(`\u001b[${row};${column}H`);
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
    for (let i = 0; i < this.totalLines; i++) {
      this.moveCursorToLine(i)
      this.clearLine()
    }
  }

  /**
   * Writes a line, assuming the cursor is already on the right line.
   */
  private writeStatusLine(lineIndex: number) {
    this.clearLine();
    const truncatedContent = (this.lines[lineIndex] || '').substring(0, (process.stdout.columns || 80) - 1);
    process.stdout.write(truncatedContent); // Write the updated content
  }

  /**
   * Redraw the entire block
   */
  private redrawAllLines(): void {
    // Ensure the space exists
    for (let i = 0; i < this.totalLines; i++) {
      process.stdout.write("\n")
    }

    // Redraw the content
    for (let i = 0; i < this.totalLines; i++) {
      this.moveCursorToLine(i)
      this.writeStatusLine(i)
    }
    this.dirty = false; // Clear the dirty flag after redrawing
  }

  /**
   * Update just one of the lines.
   */
  private updateSingleLine(lineIndex: number): void {
    this.moveCursorToLine(lineIndex);
    this.writeStatusLine(lineIndex)
  }

  /**
   * Move cursor to the bottom of the block (for unhooking and final positioning)
   */
  private moveCursorToBottom(): void {
    process.stdout.write(`\u001b[${process.stdout.rows};1H`);
  }

  /**
   * Update a single line, which will redraw everything if other console activity happened.
   */
  update(lineIndex: number, content: string): void {
    if (lineIndex < 0 || lineIndex >= this.totalLines) {
      throw new Error("Line index out of range");
    }

    // Update internal state with the full content (not truncated)
    this.lines[lineIndex] = content;

    // If the screen is dirty, do a full redraw, otherwise just update one line
    if (this.dirty) {
      this.redrawAllLines();
    } else {
      this.updateSingleLine(lineIndex);
    }
  }

  /**
   * Begin the process with blank status lines.
   */
  start(): void {

    // Create the space
    this.lines = Array(this.totalLines).fill('');
    for (let i = 0; i < this.totalLines; i++) {
      console.log("")
    }
    console.log("")

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
      // Move the cursor to the top of the block to prepend the external log, if we haven't already
      if (!this.dirty) {
        this.clearLines();
        // this.moveCursorToTop();
        this.dirty = true;
      }
      // Print the intercepted log message
      originalFn.apply(console, args);
      // Mark the console as dirty so it redraws on the next update
    };
  }
}

/////////////////////////////////////////////////
// Example usage

// function sleep(ms: number): Promise<void> {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// (async () => {
//   const N_LINES = 5
//   const cm = new StatusManager(N_LINES);

//   cm.start()

//   for (var i = 0; i < 100; ++i) {
//     const line = Math.floor(Math.random() * N_LINES)
//     if (i > 0 && i % 10 == 0) {
//       console.log("one thing")
//       console.log("and another")
//     }
//     cm.update(line, `For line ${line} at ${new Date().toLocaleTimeString()}: ${i}`);
//     await sleep(50)
//   }

//   cm.stop()

// })().then(() => console.log("Done."))