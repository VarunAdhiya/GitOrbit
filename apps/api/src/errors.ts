export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public diagnostics?: { providerStatus?: number; failure?: string },
  ) {
    super(message);
  }
}
