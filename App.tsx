
import React, { useState } from 'react';
import CommandHub from './ui/command-hub/CommandHub';
import BinaryStreamBackground from './components/BinaryStreamBackground';
import ChatInterface from './components/ChatInterface';
import { ThemeProvider } from './context/ThemeContext';

const App: React.FC = () => {
  const [legacy, setLegacy] = useState(false);
  if (!legacy) return <CommandHub onLegacy={() => setLegacy(true)} />;
  return (
    <ThemeProvider>
      <main className="relative h-[100dvh] w-screen overflow-hidden bg-black font-mono">
        <BinaryStreamBackground />
        <div className="relative z-10 flex h-full w-full flex-col">
          <button onClick={() => setLegacy(false)} style={{position:"absolute", top:8, right:16, zIndex:100, background:"#243e2c", color:"#e1bd6b", padding:"8px 14px", borderRadius:8}}>Return to Command hub</button>
          <ChatInterface />
        </div>
      </main>
    </ThemeProvider>
  );
};

export default App;
