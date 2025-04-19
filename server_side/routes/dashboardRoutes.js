router.post('/create', async (req, res) => {
  try {
    const { userId, username, tableName, dbName } = req.body;
    
    if (!userId || !username) {
      return res.status(400).json({
        success: false,
        message: 'User ID and username are required'
      });
    }

    const dashboardService = new DashboardCreationService();
    const result = await dashboardService.createDashboardForTable(
      userId,
      username,
      tableName,
      dbName
    );
    
    res.json({
      success: true,
      message: `Dashboard created by ${username}`,
      data: result
    });
  } catch (error) {
    console.error('Dashboard creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create dashboard',
      error: error.message
    });
  }
}); 