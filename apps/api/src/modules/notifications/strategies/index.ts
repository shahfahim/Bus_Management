import { NotificationDispatcher } from './NotificationStrategy.js';
import { InAppStrategy } from './InAppStrategy.js';
import { PushStrategy } from './PushStrategy.js';

export const notificationDispatcher = new NotificationDispatcher();

// Register the strategies
notificationDispatcher.registerStrategy(new InAppStrategy());
notificationDispatcher.registerStrategy(new PushStrategy());

export * from './NotificationStrategy.js';
export * from './InAppStrategy.js';
export * from './PushStrategy.js';
