import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TrainingDataPanel } from './components/TrainingDataPanel';
import './styles.css';
import './trainingData.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
    <div className="app-shell training-data-shell">
      <TrainingDataPanel />
    </div>
  </StrictMode>,
);
