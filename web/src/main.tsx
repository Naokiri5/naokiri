import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { MiaThemeProvider } from './theme';
import './styles.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><MiaThemeProvider><App /></MiaThemeProvider></BrowserRouter>);
