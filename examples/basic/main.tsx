import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) throw new Error('The page has no element with id "root".');
createRoot(container).render(<App />);
