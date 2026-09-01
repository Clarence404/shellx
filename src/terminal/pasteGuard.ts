/** Whether a paste deserves a look before it reaches the shell. Any
 *  line break executes a command the moment it lands (unless the remote
 *  app negotiated bracketed paste), and a very long single line is
 *  usually an accident — both get the confirmation dialog. A trailing
 *  newline alone still executes, so it counts too. */
export function needsPasteConfirm(text: string): boolean {
  return /[\r\n]/.test(text) || text.length > 500;
}
