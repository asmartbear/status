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

  /**
   * When we're in the status-update backoff period, this object will be
   * non-null, and status updates should be placed there instead of directly
   * onto the screen.  Otherwise, send the update directly, and start the
   * backoff period/timer.
   */
  private backoffUpdates: Map<K, string> | null = null;

  /**
   * When we're in the backoff period, this is the timer we're using.
   */
  private backoffTimer: NodeJS.Timeout | null = null;

  /**
   * When we're in the backoff period, this the milliseconds when we'll refresh next.
   * If the system is context-switching a lot, our timer will run and we'll refresh.
   * If not, we might notice that it's been too long, and manually trigger a flush.
   */
  private nextBackoffRefresh: number | undefined;

  /**
   * How often we should refresh the screen, in milliseconds.  This minimizes
   * the amount of time spent waiting for status updates, which is great when
   * updates are coming quickly, but potentially decreases the user's experience.
   * 
   * Clients can adjust this value at any time; it will go into effect after the
   * next timed update.
   */
  public screenRefreshRateMs: number = 50;

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
    const truncatedContent = (this.statusLines.get(key) || '').substring(offset, (process.stdout.columns || 80) - 1);
    process.stdout.write(truncatedContent); // Write the updated content
    process.stdout.write('\u001b[0K');   // Clear remainder of the line
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

    // Redraw the content.
    // Because we're redrawing everything, there's no longer a need for a backoff period.
    // Replace our known-lines with the backoff ones, if any, and clear the backoff.
    for (const key of this.lineNumbers.keys()) {
      const backoffMessage = this.backoffUpdates?.get(key)
      if (backoffMessage) {
        this.statusLines.set(key, backoffMessage)   // update directly
      }
      this.updateSingleLine(key, 0, 0)
    }
    this.dirty = false; // Clear the dirty flag after redrawing
    this.resetBackoffTimer()    // Reset the backoff from this point
  }

  /**
   * Update just one of the lines.
   */
  private updateSingleLine(key: K, column: number, offset: number): void {
    const line = this.lineNumbers.get(key)
    if (line !== undefined) {
      this.moveCursorToLine(line, column)
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
   * 
   * @param key the key indicating which status line; creates a new one if the key doesn't exist
   * @param content the new content for the line; will be truncated to the width of the terminal
   * @param always if true, will update the line even if we're in the backoff period, otherwise will honor the screen-refresh rate.
   */
  update(key: K, content: string): void;
  update(key: K, content: string, always: boolean): void;
  update(key: K, content: string, always: null): void;
  update(key: K, content: string, always: boolean | null = false): void {
    var redrawFromThisSpot = true

    // Set the line content, and create a new line if needed
    const prev = this.statusLines.get(key);
    let offset = 0
    if (prev) {
      // If status is identical, do nothing
      if (prev == content) {
        return
      }
      // If we're in the backoff period, just record the potential update.
      // There might be many more coming, so don't compute anything else about it.
      // Although this can be overridden by the user
      if (this.backoffUpdates) {
        if (always !== false || this.dirty) {   // if we draw-always, remove this key from the backoff and proceed now
          if (always !== null) {      // special marker that this is being called from the backoff timer, so just do it without other state changes
            this.backoffUpdates.delete(key)
          }
        } else {        // remember the update for later
          this.backoffUpdates.set(key, content)
          this.flushBackoffUpdates(false)     // take this opportunity to ask whether it's actually time to flush
          return
        }
      }
      // Check for common prefix, as this means fewer console operations
      offset = getCommonPrefixLength(prev, content)
    } else {
      // If we're already dirty, redraw from this spot to make room
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

    // If we have an offset in the string, convert to a column.
    // We have to count graphemes, otherwise emoji and such throws us off.
    let column = 0
    if (offset > 0) {
      const graphemes = Array.from(content)
      for (var i = 0; i < offset;) {
        i += graphemes[column].length
        ++column
      }
    }

    // If the screen is dirty, do a full redraw, otherwise update just the one line
    if (this.dirty) {
      this.redrawAllLines(redrawFromThisSpot);
    } else {
      this.updateSingleLine(key, column, offset);
    }
    this.moveCursorToBottom()

    // Start the backoff period if needed
    if (!this.backoffUpdates) {
      this.resetBackoffTimer()
    }
  }

  /**
   * Flush any remaining backoff updates, and reset that state.  Does nothing if we're not in backoff mode.
   * 
   * @param force if true, always flush.  Otherwise, consult the backoff timer, and don't flush if the timer hasn't elapsed.
   */
  private flushBackoffUpdates(force: boolean) {
    if (this.backoffUpdates && this.nextBackoffRefresh && (force || Date.now() > this.nextBackoffRefresh)) {
      for (const [key, content] of this.backoffUpdates) {
        this.update(key, content, null)
      }
      this.backoffUpdates = null
      this.nextBackoffRefresh = undefined
    }
  }

  private resetBackoffTimer() {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.nextBackoffRefresh = undefined
    }
    this.backoffUpdates = new Map<K, string>()
    this.backoffTimer = setTimeout(() => this.flushBackoffUpdates(true), this.screenRefreshRateMs)
    this.nextBackoffRefresh = Date.now() + this.screenRefreshRateMs * 2   // give it time to run in a normal fashion
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

    // Flush remaining updates
    this.flushBackoffUpdates(true)

    // Move the cursor to the bottom of the block to resume normal output
    this.moveCursorToBottom();

    // Restore console functions
    console.log = this.originalLog;
    console.error = this.originalError;
    console.warn = this.originalWarn;
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

//   for (var i = 1; i <= 2000; ++i) {
//     const line = Math.floor(Math.random() * N_LINES)
//     if (i % 400 == 0) {
//       console.warn("one thing")
//       console.error("and another", Math.random())
//     }
//     cm.update(line, `🏃‍♂️ For line ${line} at ${new Date().toLocaleTimeString()}: ${i}: ${"*".repeat(i % 10)}`);
//     await sleep(2)
//   }

//   cm.stop()

// })().then(() => console.log("Done."))