import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { DialogHost } from './components/shared/Dialog.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <DialogHost />
  </StrictMode>,
);
