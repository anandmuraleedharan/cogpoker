import { test, expect } from '@playwright/test';

test.describe('CogPoker Real-Time Sizing Workflow and Multi-User Sync', () => {
  test('should handle onboarding, theme selection, real-time ticket broadcasts, voting, reveals, and complete rounds', async ({ playwright }) => {
    const browser = await playwright.chromium.launch();
    
    // 1. Launch Moderator Page in Context 1
    const contextHost = await browser.newContext();
    const pageHost = await contextHost.newPage();
    await pageHost.goto('/');
    
    // Perform host onboarding
    await pageHost.fill('#display-name', 'Gandalf Host');
    await pageHost.click('button:has-text("Create New Room")');
    
    // Wait to land on room page and extract Room ID
    await pageHost.waitForURL(/\/room\/[A-Z0-9]+/);
    const hostUrl = pageHost.url();
    const roomIdMatch = hostUrl.match(/\/room\/([A-Z0-9]+)/);
    expect(roomIdMatch).not.toBeNull();
    const roomId = roomIdMatch![1];
    console.log(`Successfully booted room: ${roomId}`);

    // Verify host is labeled as Moderator
    await expect(pageHost.locator('text=Host Control')).toBeVisible();

    // 2. Launch Player Page in Context 2 (fully isolated storage)
    const contextPlayer = await browser.newContext();
    const pagePlayer = await contextPlayer.newPage();
    await pagePlayer.goto(`/?room=${roomId}`);
    
    // Perform player onboarding
    await pagePlayer.fill('#display-name', 'Bilbo Player');
    await pagePlayer.click('button:has-text("Join Estimate Room")');
    
    // Wait to land on the room page
    await pagePlayer.waitForURL(new RegExp(`/room/${roomId}`));

    // Verify player is on the estimator workspace
    await expect(pagePlayer.locator('text=Cast Your Estimate')).toBeVisible();
    await expect(pagePlayer.locator('text=Waiting for host to set a ticket...')).toBeVisible();

    // 3. Verify presence sync
    // The player's card should show up on the board for both clients
    await expect(pageHost.locator('text=Bilbo Player')).toBeVisible();
    await expect(pagePlayer.locator('text=Bilbo Player (You)')).toBeVisible();

    // Verify host is excluded from voting cards
    await expect(pageHost.locator('text=Gandalf Host')).not.toBeVisible();
    await expect(pagePlayer.locator('text=Gandalf Host')).not.toBeVisible();

    // 4. Test Theme Toggling (Verify root element class propagation)
    // Switch to Cyberpunk Theme
    await pageHost.click('button:has-text("cyberpunk")');
    await expect(pageHost.locator('html')).toHaveClass(/theme-cyberpunk/);
    
    // Switch to Guild Tavern Theme
    await pageHost.click('button:has-text("tavern")');
    await expect(pageHost.locator('html')).toHaveClass(/theme-tavern/);
    
    // Switch to Retro Arcade Theme
    await pageHost.click('button:has-text("arcade")');
    await expect(pageHost.locator('html')).toHaveClass(/theme-arcade/);
    
    // Toggle Light Mode
    const initialMode = await pageHost.locator('html').evaluate(el => el.classList.contains('mode-dark'));
    await pageHost.click('button[title="Toggle Light/Dark Mode"]');
    if (initialMode) {
      await expect(pageHost.locator('html')).toHaveClass(/mode-light/);
    } else {
      await expect(pageHost.locator('html')).toHaveClass(/mode-dark/);
    }
    // Toggle back to dark
    await pageHost.click('button[title="Toggle Light/Dark Mode"]');

    // 5. Host broadcasts a new ticket with 'hybrid' track
    await pageHost.fill('#ticket-title', 'Refactor Payment Gateways');
    await pageHost.fill('#ticket-desc', 'Migrate Stripe logic to support Apple Pay APIs.');
    
    // Click 'hybrid' track button
    await pageHost.click('button:has-text("hybrid")');
    
    // Click broadcast
    await pageHost.click('button:has-text("Broadcast Ticket Update")');

    // Verify player client receives the update in real-time
    await expect(pagePlayer.locator('text=Refactor Payment Gateways')).toBeVisible();
    await expect(pagePlayer.locator('text=Migrate Stripe logic')).toBeVisible();
    await expect(pagePlayer.locator('span:has-text("hybrid")')).toBeVisible();

    // Verify factor sliders are updated to Hybrid factors
    await expect(pagePlayer.locator('text=Verification Overhead')).toBeVisible();
    await expect(pagePlayer.locator('text=Architecture Review')).toBeVisible();

    // 6. Player casts factor ratings and votes
    // We adjust the sliders
    const slider = pagePlayer.locator('input[type="range"]').first();
    await slider.fill('4'); // set to 4

    // Cast vote: click card '5' exactly
    await pagePlayer.locator('.theme-card:has-text("Cast Your Estimate") >> button').filter({ hasText: /^5$/ }).click();

    // Verify card turns locked on player page
    await expect(pagePlayer.locator('text=Vote Cast: Card 5 (Locked)')).toBeVisible();

    // Verify host board shows player has voted
    // Player card shows checkmark (✓) but not the value yet
    await expect(pageHost.locator('.theme-card:has-text("Bilbo Player")').locator('div', { hasText: /^✓$/ })).toBeVisible();

    // 7. Host reveals the card votes
    await pageHost.click('button:has-text("Reveal Player Cards")');

    // Verify both pages display revealed card values exactly
    await expect(pageHost.locator('.theme-card:has-text("Bilbo Player")').locator('div', { hasText: /^5$/ })).toBeVisible();
    await expect(pagePlayer.locator('.theme-card:has-text("Bilbo Player (You)")').locator('div', { hasText: /^5$/ })).toBeVisible();

    // Verify factors are visible post-reveal
    await expect(pageHost.locator('text=Verification Overhead:')).toBeVisible();
    await expect(pagePlayer.locator('text=Verification Overhead:')).toBeVisible();

    // Verify stats summaries
    await expect(pageHost.locator('text=Average Estimate:')).toBeVisible();
    await expect(pagePlayer.locator('text=Average Estimate:')).toBeVisible();

    // 8. Complete current round
    await pageHost.fill('input[placeholder="e.g. 5, 8, 16k"]', '5');
    await pageHost.click('button:has-text("Complete")');

    // Verify board resets
    await expect(pagePlayer.locator('text=Waiting for host to set a ticket...')).toBeVisible();

    // Verify round is stored in history log on both clients
    await expect(pageHost.locator('text=Refactor Payment Gateways')).toBeVisible();
    await expect(pagePlayer.locator('text=Refactor Payment Gateways')).toBeVisible();
    await expect(pageHost.locator('text=5 PTS')).toBeVisible();
    await expect(pagePlayer.locator('text=5 PTS')).toBeVisible();

    // 9. Leave Room & Close Session verification
    // Player leaves the room manually
    await pagePlayer.click('button:has-text("Leave Room")');
    await pagePlayer.waitForURL(pagePlayer.url().split('/room/')[0]); // wait to return to onboarding '/'
    await expect(pagePlayer.locator('text=Create New Room')).toBeVisible();

    // Host closes/ends session for everyone
    await pageHost.click('button:has-text("Close Session & End Room")');
    await pageHost.waitForURL(pageHost.url().split('/room/')[0]); // wait to return to onboarding '/'
    await expect(pageHost.locator('text=Create New Room')).toBeVisible();

    await browser.close();
  });
});
