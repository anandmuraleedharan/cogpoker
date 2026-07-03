import { test, expect } from '@playwright/test';

test.describe('CogPoker 10-User 10-Round Sizing Scale Test', () => {
  // Set test timeout to 3 minutes to handle 10 browser instances running 10 rounds
  test.setTimeout(180000);

  test('should successfully run 10 sizing rounds with 1 moderator and 9 players', async ({ playwright }) => {
    const browser = await playwright.chromium.launch();

    // 1. Launch Moderator Page
    const contextHost = await browser.newContext();
    const pageHost = await contextHost.newPage();
    pageHost.on('console', msg => {
      if (msg.type() === 'warning' || msg.type() === 'error' || msg.text().includes('realtime') || msg.text().includes('Realtime')) {
        console.log(`[HOST CONSOLE] ${msg.type()}: ${msg.text()}`);
      }
    });
    await pageHost.goto('/');

    await pageHost.fill('#display-name', 'Host Moderator');
    await pageHost.click('button:has-text("Create New Room")');

    await pageHost.waitForURL(/\/room\/[A-Z0-9]+/);
    const roomIdMatch = pageHost.url().match(/\/room\/([A-Z0-9]+)/);
    expect(roomIdMatch).not.toBeNull();
    const roomId = roomIdMatch![1];
    console.log(`[SCALE TEST] Booted room: ${roomId}`);

    // Verify moderator console
    await expect(pageHost.locator('text=Host Control')).toBeVisible();

    // 2. Launch 9 Player Pages in Parallel Contexts
    const numPlayers = 9;
    const playerContexts: any[] = [];
    const playerPages: any[] = [];

    console.log(`[SCALE TEST] Launching ${numPlayers} player contexts...`);
    await Promise.all(
      Array.from({ length: numPlayers }).map(async (_, idx) => {
        const context = await browser.newContext();
        playerContexts.push(context);

        const page = await context.newPage();
        page.on('console', msg => {
          if (msg.type() === 'warning' || msg.type() === 'error' || msg.text().includes('realtime') || msg.text().includes('Realtime')) {
            console.log(`[PLAYER ${idx + 1} CONSOLE] ${msg.type()}: ${msg.text()}`);
          }
        });
        await page.goto(`/?room=${roomId}`);

        await page.fill('#display-name', `Player ${idx + 1}`);
        await page.click('button:has-text("Join Estimate Room")');

        await page.waitForURL(new RegExp(`/room/${roomId}`));
        playerPages.push(page);
        console.log(`[SCALE TEST] Player ${idx + 1} joined room.`);
      })
    );

    // Give WebSockets/Presence a moment to stabilize
    await pageHost.waitForTimeout(2000);

    // 3. Execute 10 Sizing Rounds sequential loop
    const numRounds = 10;
    for (let r = 1; r <= numRounds; r++) {
      console.log(`[SCALE TEST] Starting Round ${r} of ${numRounds}...`);
      await pageHost.waitForTimeout(2500);

      const ticketTitle = `Scalability Feature Ticket ${r}`;
      const ticketDesc = `Detailed performance requirements description for scaling benchmark round ${r}.`;

      // Moderator inputs and broadcasts ticket details
      await pageHost.fill('#ticket-title', ticketTitle);
      await pageHost.fill('#ticket-desc', ticketDesc);
      await pageHost.click('button:has-text("Broadcast Ticket Update")');

      // Verify players receive the ticket broadcast
      await Promise.all(
        playerPages.map(async (page, idx) => {
          await expect(page.locator(`text=${ticketTitle}`)).toBeVisible({ timeout: 5000 });
        })
      );

      // Each player casts their vote sequentially to spread out WebSocket traffic and avoid rate-limiting
      console.log(`[SCALE TEST] Round ${r}: Estimators casting votes...`);
      for (let idx = 0; idx < playerPages.length; idx++) {
        const page = playerPages[idx];
        const cards = ['3', '5', '8', '13'];
        const selectedCard = cards[idx % cards.length];
        
        await page.locator('.theme-card:has-text("Cast Your Estimate") >> button').filter({ hasText: new RegExp('^' + selectedCard + '$') }).click();
        await expect(page.locator('text=Change Vote')).toBeVisible({ timeout: 5000 });
        
        // Wait 300ms between each player's vote to stay well within Supabase rate limits
        await pageHost.waitForTimeout(300);
      }

      // Verify host sees vote completion updates
      // Wait for reveal button to show all voted status
      await expect(pageHost.locator('text=Reveal Player Cards (All Voted!)')).toBeVisible({ timeout: 10000 });

      // Host reveals cards
      console.log(`[SCALE TEST] Round ${r}: Host revealing cards...`);
      await pageHost.click('button:has-text("Reveal Player Cards (All Voted!)")');

      // Verify cards are flipped/revealed on all screens
      await Promise.all(
        playerPages.map(async (page) => {
          await expect(page.locator('text=Sizing Insights & Analytics')).toBeVisible({ timeout: 5000 });
        })
      );

      // Host chooses agreement score override card (first card in quick select deck, e.g. "0" or "1")
      // In Human track, Fibonacci deck has card buttons. Let's select card button "8" from agreement deck
      await pageHost.click(`button[type="button"]:has-text("8")`);

      // Host completes round
      console.log(`[SCALE TEST] Round ${r}: Completing round...`);
      await pageHost.click('button:has-text("Complete")');

      // Verify active poker board has reset on all screens
      await Promise.all(
        playerPages.map(async (page) => {
          await expect(page.locator('text=Waiting for host to set a ticket...')).toBeVisible({ timeout: 5000 });
        })
      );

      // Verify the completed round is present in the history logs
      await expect(pageHost.locator(`text=${ticketTitle}`)).toBeVisible();
      console.log(`[SCALE TEST] Round ${r} completed and verified successfully.`);
    }

    // 4. Session Termination & Cleanup
    console.log('[SCALE TEST] Terminating session...');
    await pageHost.click('button:has-text("Close Session & End Room")');

    // Verify all players redirected back to '/' onboarding
    await Promise.all(
      playerPages.map(async (page) => {
        await page.waitForURL(page.url().split('/room/')[0]);
        await expect(page.locator('text=Create New Room')).toBeVisible();
      })
    );

    await pageHost.waitForURL(pageHost.url().split('/room/')[0]);
    await expect(pageHost.locator('text=Create New Room')).toBeVisible();

    // Close all contexts
    console.log('[SCALE TEST] Closing all pages...');
    await Promise.all(playerContexts.map(ctx => ctx.close()));
    await contextHost.close();
    await browser.close();

    console.log('[SCALE TEST] Scale test completed successfully! 10 users and 10 rounds validated.');
  });
});
