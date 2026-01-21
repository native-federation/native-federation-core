export interface BuildNotificationOptions {
  enable: boolean;
  endpoint: string;
}

export enum BuildNotificationType {
  COMPLETED = 'federation-rebuild-complete',
  ERROR = 'federation-rebuild-error',
  CANCELLED = 'federation-rebuild-cancelled',
}
