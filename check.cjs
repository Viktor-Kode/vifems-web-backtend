const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearDB() {
  // Delete in correct order to respect foreign key constraints
  const deletedTokens = await prisma.passwordResetToken.deleteMany({});
  console.log(`Deleted ${deletedTokens.count} password reset tokens`);

  const deletedUsers = await prisma.user.deleteMany({});
  console.log(`Deleted ${deletedUsers.count} users`);

  // Verify empty
  const userCount = await prisma.user.count();
  const tokenCount = await prisma.passwordResetToken.count();
  console.log(`\nVerification — Users: ${userCount}, Tokens: ${tokenCount}`);
  console.log("DB cleared successfully.");
}

clearDB()
  .catch(e => console.error("Error:", e))
  .finally(async () => {
    await prisma.$disconnect();
  });
