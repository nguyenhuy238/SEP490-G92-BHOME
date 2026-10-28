
import React from 'react';
import ReactDOM from 'react-dom/client';

import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

import App from './app/App';
import { AppProviders } from './app/providers/AppProviders';

ReactDOM.createRoot(
  document.getElementById('root')!
).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);
