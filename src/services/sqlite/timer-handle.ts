/** A timer handle that may be unref'd so it never keeps the process alive. */
export interface Unrefable {
  unref?: () => void;
}
