# Feature #0 - Authentication Testing Steps

## Manual Testing Instructions

### Step 1: Navigate to homepage
- URL: http://localhost:3000
- ✅ VERIFIED: Login page loads correctly

### Step 2: Enter credentials
- Email: admin@contoso.com
- Password: demo123

### Step 3: Click Sign In button

### Step 4: Verify redirect to dashboard
- Should redirect to /dashboard

### Step 5: Verify user profile information
- Name should display: "Admin User"
- Email should display: "admin@contoso.com"
- Roles should display: Admin, Reviewer, Contributor

### Step 6: Verify authentication success message
- Green success banner should appear

## Evidence Captured
- Screenshot 1: Login page (feature_0_login_page.png)
- Screenshot 2: Dashboard after login (to be captured)

## Test Accounts Available
- admin@contoso.com / demo123 (Admin, Reviewer, Contributor)
- reviewer@contoso.com / demo123 (Reviewer, Contributor)
- user@contoso.com / demo123 (Contributor)
