import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setLogContext } from '../../lib/debugLog';
import { applyCachedAppearance } from '../../lib/appearance';
import { detectPopupHost } from './host';
import '../shared.css';
import './popup.css';

// First, so an iPhone's sheet layout is in place for the first paint.
detectPopupHost();
setLogContext('popup');
applyCachedAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
