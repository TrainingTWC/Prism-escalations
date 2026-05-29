import { NextResponse, type NextRequest } from 'next/server'

// The proxy checks a lightweight 'prism-auth' indicator cookie for routing/redirects.
// Actual API security is enforced by Supabase JWTs and RLS — this is routing only.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const hasAuth = request.cookies.has('prism-auth')

  // Redirect unauthenticated users to login
  if (!hasAuth && !pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from login
  if (hasAuth && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
