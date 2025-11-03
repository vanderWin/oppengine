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
      <a
        href="https://www.journeyfurther.com/?utm_source=oppengine&utm_medium=referral&utm_campaign=app_footer&utm_content=logo"
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-full w-full items-center justify-center px-6"
        aria-label="Visit Journey Further website"
      >
        <img
          src="/logo.svg"
          alt="Journey Further"
          className="h-16 w-auto object-contain"
          loading="lazy"
        />
      </a>
    </footer>
  );
}
