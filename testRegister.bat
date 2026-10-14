@echo off
curl -s -X POST http://localhost:5000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"fullName\":\"Test User\",\"email\":\"testclear@test.com\",\"password\":\"password123\"}"
echo.
echo.
echo --- Now check all users ---
curl -s http://localhost:5000/api/health
