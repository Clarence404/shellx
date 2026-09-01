export interface Snippet {
  id: string;
  name: string;
  command: string;
  /** Whether picking this snippet also presses Enter. Off by default —
   *  a command the user reads before running is the safe default. */
  autoEnter: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface NewSnippet {
  name: string;
  command: string;
  autoEnter: boolean;
}
