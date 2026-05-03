import React, { useEffect, useState } from 'react';

export default function SplashScreen({ onFinish }) {
  const [loadingText, setLoadingText] = useState('Initializing Core Systems...');

  useEffect(() => {
    const timer1 = setTimeout(() => setLoadingText('Loading Solver Engines...'), 1000);
    const timer2 = setTimeout(() => setLoadingText('Connecting to Local Database...'), 2000);
    const timer3 = setTimeout(() => onFinish(), 3000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onFinish]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-brand-blue text-white z-50">
      <div className="animate-slide-up flex flex-col items-center">

        {/* 앱 아이콘 */}
        <div className="mb-8 p-6 bg-white rounded-3xl shadow-2xl shadow-black/30">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="HiTESS WorkBench"
            className="h-20 w-auto object-contain"
          />
        </div>
        
        {/* Title */}
        <h1 className="text-4xl font-bold tracking-widest mb-2 font-mono drop-shadow-md">
          HiTESS <span className="text-brand-accent">WorkBench</span>
        </h1>
        <p className="text-slate-300 text-sm tracking-widest uppercase mb-12">
          Structural Analysis Platform
        </p>

        {/* Loading Bar (색상도 테마에 맞춤) */}
        <div className="w-64 h-1 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-brand-accent animate-[width_3s_ease-in-out_forwards]" style={{ width: '100%' }}></div>
        </div>
        
        {/* Dynamic Loading Text */}
        <p className="mt-3 text-xs text-slate-400 font-mono animate-pulse">
          {loadingText}
        </p>
      </div>
    </div>
  );
}