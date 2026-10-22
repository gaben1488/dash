/**
 * This is the ONLY preview boot entry.
 * Do not render replacement page mockups. Import the existing production
 * main.tsx once after installing a read-only, synthetic API transport.
 */
import { installSyntheticApi } from './synthetic-api';
import { installDesignControls } from './design-controls';

installSyntheticApi();
void import('../main').then(async () => {
  await import('./theme.css');
  installDesignControls();
});
