import React from 'react';
import { useE2eCommandHandler } from './useE2eCommandHandler';
import { useE2eUiProbes } from './useE2eUiProbes';

/** Collection-subscribed e2e probes live off the App fiber so load-more does not re-render the shell. */
export const FeedE2eCollectionHost: React.FC = () => {
  useE2eUiProbes();
  useE2eCommandHandler();
  return null;
};
