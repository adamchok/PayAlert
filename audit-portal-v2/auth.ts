import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      authorize(credentials) {
        const { username, password } = credentials
        if (
          typeof username === 'string' &&
          typeof password === 'string' &&
          username.length > 0 &&
          username === process.env.PORTAL_USERNAME &&
          password === process.env.PORTAL_PASSWORD
        ) {
          return { id: '1', name: username }
        }
        return null
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
})
