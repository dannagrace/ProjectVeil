interface StartH5ClientAppOptions {
  bootstrapApp: () => Promise<void>;
  registerAutomationHooks: () => void;
  reportBootstrapError?: (error: unknown) => void;
}

export function startH5ClientApp({
  bootstrapApp,
  registerAutomationHooks,
  reportBootstrapError
}: StartH5ClientAppOptions): void {
  void bootstrapApp().catch((error) => {
    reportBootstrapError?.(error);
  });
  registerAutomationHooks();
}
