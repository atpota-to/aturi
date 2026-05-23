import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setLogContext } from '../../lib/debugLog';
import '../shared.css';
import './popup.css';

setLogContext('popup');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
