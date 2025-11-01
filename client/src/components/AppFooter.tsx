export function AppFooter() {
  return (
    <footer 
      className="flex items-center justify-center border-t"
      style={{ 
        backgroundColor: '#2b0573',
        height: '100px',
        minHeight: '100px'
      }}
    >
      <img 
        src="/logo.svg" 
        alt="OppEngine Logo" 
        className="max-h-[80px] max-w-[80%] object-contain"
        style={{ filter: 'brightness(0) invert(1)' }}
      />
    </footer>
  );
}
