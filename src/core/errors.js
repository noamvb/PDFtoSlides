export class PdfError extends Error {
  /**
   * @param {string} code one of the CODES below
   * @param {string} message human-readable, shown in the UI
   * @param {Error} [cause] original error, shown only in the technical detail
   */
  constructor(code, message, cause) {
    super(message);
    this.name = "PdfError";
    this.code = code;
    this.cause = cause;
  }
}

export const CODES = Object.freeze({
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  PASSWORD_WRONG: "PASSWORD_WRONG",
  CORRUPT: "CORRUPT",
  NOT_A_PDF: "NOT_A_PDF",
  RENDER_FAILED: "RENDER_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
  DISK_FULL: "DISK_FULL",
  PERMISSION: "PERMISSION",
  CANCELLED: "CANCELLED",
});
