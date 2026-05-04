import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6', // Bright Blue
      light: '#60a5fa',
    },
    secondary: {
      main: '#8b5cf6', // Violet
    },
    background: {
      default: '#020617', // Slate 950 (Deepest dark)
      paper: 'rgba(15, 23, 42, 0.8)', // Slate 900 with opacity
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: '"Inter", "Poppins", sans-serif',
    h4: { fontWeight: 800, letterSpacing: '-0.02em' },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        body {
          background: radial-gradient(circle at 50% 0%, #1e293b 0%, #020617 100%);
          background-attachment: fixed;
          scrollbar-width: thin;
          scrollbar-color: #334155 transparent;
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
      `,
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          backgroundImage: 'none',
        },
      },
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
