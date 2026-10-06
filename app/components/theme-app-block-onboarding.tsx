export function ThemeAppBlockOnboarding({ shopHandle }: { shopHandle: string }) {
  const themesUrl = `https://admin.shopify.com/store/${encodeURIComponent(shopHandle)}/themes`;

  return (
    <div className="theme-onboarding">
      <div className="theme-onboarding__intro">
        <h3>Add raffle entry to your storefront</h3>
        <p>
          Choose the theme you want to update, then add Fairdrop from the theme
          editor. The block automatically displays raffles while they are open;
          you do not need to enter a raffle handle.
        </p>
      </div>
      <ol className="theme-onboarding__steps">
        <li>
          <a href={themesUrl} target="_top">Choose a theme and click Customize</a>.
          You can select your published theme or preview another theme first.
        </li>
        <li>
          In the theme editor, open the page template where customers should enter.
          Choose <strong>Add section</strong>, then <strong>Apps</strong>, then
          <strong> Fairdrop raffle entry</strong>.
        </li>
        <li>
          Reposition the block, edit its section heading if you like, and click
          <strong> Save</strong>.
        </li>
      </ol>
      <p className="theme-onboarding__compatibility">
        <strong>Theme support:</strong> App blocks require an Online Store 2.0
        theme with JSON templates and a section that supports app blocks. If
        Fairdrop is not listed under Apps, try a compatible section or an Online
        Store 2.0 theme. When a raffle hides its product from the Online Store,
        place the entry block on a different published page.
      </p>
      <a className="admin-button admin-button--primary" href={themesUrl} target="_top">
        Choose theme and open theme settings
      </a>
    </div>
  );
}
