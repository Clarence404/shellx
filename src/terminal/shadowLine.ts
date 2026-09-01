/**
 * A local mirror of the line being typed into a remote shell.
 *
 * The terminal is a byte pipe — the shell runs on the other end, so
 * nothing on this side actually KNOWS the current command line. This
 * class rebuilds it from the keystrokes on their way out, the same
 * trick WindTerm and XShell play: exact for the ordinary case of
 * typing a command left to right, and honest about giving up the
 * moment the input does something it cannot follow (Tab completion,
 * arrow keys, readline shortcuts) — `valid` drops to false and stays
 * there until the next line starts.
 */
export class ShadowLine {
  private chars: string[] = [];
  /** False while the real line may differ from the mirror. */
  valid = true;

  get line(): string {
    return this.chars.join("");
  }

  /** Feeds one xterm `onData` payload (a keystroke, or a whole paste).
   *  Returns the commands this chunk submitted — a pasted script can
   *  carry several. */
  feed(data: string): string[] {
    const submitted: string[] = [];
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === "\r" || ch === "\n") {
        if (this.valid && this.line.trim().length > 0) submitted.push(this.line);
        // Whatever happened before, a fresh line is trustworthy again.
        this.chars = [];
        this.valid = true;
        if (ch === "\r" && data[i + 1] === "\n") i++;
      } else if (ch === "\x7f" || ch === "\b") {
        this.chars.pop();
      } else if (ch === "\x15" /* Ctrl+U — kill line */ || ch === "\x03" /* Ctrl+C */) {
        this.chars = [];
        this.valid = true;
      } else if (ch === "\x17" /* Ctrl+W — kill word */) {
        while (this.chars.length && this.chars[this.chars.length - 1] === " ") this.chars.pop();
        while (this.chars.length && this.chars[this.chars.length - 1] !== " ") this.chars.pop();
      } else if (ch === "\t") {
        // The shell will complete this line out of our sight.
        this.invalidate();
      } else if (ch === "\x1b") {
        // Escape sequence — arrows, Home/End, Alt-anything, bracketed
        // paste. The cursor went somewhere we cannot see. Skip the rest
        // of a CSI/SS3 sequence so its letters don't read as typing.
        this.invalidate();
        if (data[i + 1] === "[" || data[i + 1] === "O") {
          i += 2;
          while (i < data.length && !/[a-zA-Z~]/.test(data[i])) i++;
        }
      } else if (ch >= " " || ch.charCodeAt(0) > 0x7f) {
        if (this.valid) this.chars.push(ch);
      } else {
        // Any other control char (Ctrl+A/E/K/R…) is line editing we
        // cannot follow.
        this.invalidate();
      }
      i++;
    }
    return submitted;
  }

  /** Text sent to the PTY directly (an accepted suggestion), which
   *  never passes through `onData` — mirror it by hand. */
  pushText(s: string) {
    if (!this.valid) return;
    for (const ch of s) this.chars.push(ch);
  }

  invalidate() {
    this.chars = [];
    this.valid = false;
  }
}
