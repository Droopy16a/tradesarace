import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const markets = [
  { currency: 'bitcoin', label: 'BTC/USD' },
  { currency: 'ethereum', label: 'ETH/USD' },
  { currency: 'solana', label: 'SOL/USD' },
  { currency: 'dogecoin', label: 'DOGE/USD' },
];

function MarketWorkspace() {
  const [activeTab, setActiveTab] = useState(0);
  const [sharedWallet, setSharedWallet] = useState({
    usdBalance: 12500,
    btcBalance: 0.35,
    bonus: 185,
  });
  const [sharedPositions, setSharedPositions] = useState([]);

  return (
    <Box sx={{ px: 1, pt: 1 }}>
      <Tabs
        value={activeTab}
        onChange={(_, nextValue) => setActiveTab(nextValue)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{
          '.MuiTab-root': { fontWeight: 700, letterSpacing: '0.04em' },
        }}
      >
        {markets.map((market) => (
          <Tab key={market.currency} label={market.label} />
        ))}
      </Tabs>

      {markets.map((market, index) => (
        <div
          key={market.currency}
          role="tabpanel"
          hidden={activeTab !== index}
          id={`market-tabpanel-${index}`}
        >
          <App
            currency={market.currency}
            wallet={sharedWallet}
            setWallet={setSharedWallet}
            positions={sharedPositions}
            setPositions={setSharedPositions}
          />
        </div>
      ))}
    </Box>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <MarketWorkspace />
    </ThemeProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a functon
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
