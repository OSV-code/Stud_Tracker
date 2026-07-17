import { useEffect, useMemo, useState } from 'react'
import {
  supabase,
  fetchStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  getPasswordPolicy,
  getUserProfileRole,
  verifyTeacherPin,
  adminSearchTeachers,
  adminSetTeacherPin
} from './supabaseClient'
import './App.css'

const initialStudentForm = {
  id: null,
  name: '',
  rollNo: '',
  className: '',
  fatherName: '',
  motherName: '',
  parentPhone: '',
  address: '',
  dob: '',
  bloodGroup: '',
  admissionNo: '',
  aadharNumber: '',
  saralPortalNumber: ''
}

function App() {
  const isAdminRoute = typeof window !== 'undefined' && window.location.pathname === '/admin'
  const [session, setSession] = useState(null)
  const [userRole, setUserRole] = useState('teacher')
  const [authLoading, setAuthLoading] = useState(true)
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [fullName, setFullName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authConfirmPassword, setAuthConfirmPassword] = useState('')
  const [pinVerified, setPinVerified] = useState(false)
  const [pinCode, setPinCode] = useState('')
  const [pinSubmitting, setPinSubmitting] = useState(false)
  const [pinError, setPinError] = useState('')
  const [showAdminSetup, setShowAdminSetup] = useState(false)
  const [teacherSearch, setTeacherSearch] = useState('')
  const [teacherList, setTeacherList] = useState([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [selectedTeacher, setSelectedTeacher] = useState(null)
  const [newTeacherPin, setNewTeacherPin] = useState('')
  const [pinValidDays, setPinValidDays] = useState(15)
  const [adminError, setAdminError] = useState('')
  const [adminNotice, setAdminNotice] = useState('')
  const [students, setStudents] = useState([])
  const [form, setForm] = useState(initialStudentForm)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedClass, setSelectedClass] = useState('all')

  useEffect(() => {
    let isMounted = true

    async function bootstrapSession() {
      const {
        data: { session: currentSession }
      } = await supabase.auth.getSession()

      if (isMounted) {
        setSession(currentSession)
        setAuthLoading(false)
      }
    }

    bootstrapSession()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
      setAuthLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (session) {
      validateSessionAndLoad()
    }
  }, [session])

  useEffect(() => {
    if (session && pinVerified) {
      loadStudents()
    }
  }, [session, pinVerified])

  useEffect(() => {
    if (session && userRole === 'admin' && (showAdminSetup || isAdminRoute)) {
      loadTeachers()
    }
  }, [session, showAdminSetup, userRole, isAdminRoute])

  async function validateSessionAndLoad() {
    try {
      const role = await getUserProfileRole(session.user.id)
      setUserRole(role)

      const policy = await getPasswordPolicy(session.user.id)

      if (!policy) {
        await supabase.auth.signOut()
        setAuthMode('login')
        setAuthError('Account policy not found. Ask admin to run password policy backfill.')
        return
      }

      const expiresAt = new Date(policy.password_expires_at)
      const isExpired = Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()

      if (policy.reset_required || isExpired) {
        await supabase.auth.signOut()
        setAuthMode('login')
        setAuthPassword('')
        setAuthConfirmPassword('')
        setAuthError('Password expired. Ask admin to set a new password for your account.')
        return
      }

      setPinVerified(false)
      setShowAdminSetup(false)
      setPinError('')
    } catch (err) {
      const message = String(err?.message || '')

      if (message.toLowerCase().includes('row-level security')) {
        await supabase.auth.signOut()
        setAuthMode('login')
        setAuthError('Access denied to password policy table. Add RLS select policy for the logged-in user.')
        return
      }

      await supabase.auth.signOut()
      setAuthMode('login')
      setAuthError(err.message || 'Session validation failed. Please sign in again.')
    }
  }

  async function handleLogin(event) {
    event.preventDefault()

    if (!authEmail || !authPassword) {
      setAuthError('Email and password are required.')
      return
    }

    setAuthSubmitting(true)
    setAuthError('')
    setAuthNotice('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword
    })

    if (signInError) {
      setAuthError(signInError.message)
    }

    setAuthSubmitting(false)
  }

  async function handleSignUp(event) {
    event.preventDefault()

    if (!fullName || !authEmail || !authPassword || !authConfirmPassword) {
      setAuthError('All fields are required for signup.')
      return
    }

    if (authPassword !== authConfirmPassword) {
      setAuthError('Passwords do not match.')
      return
    }

    if (authPassword.length < 6) {
      setAuthError('Password should be at least 6 characters.')
      return
    }

    setAuthSubmitting(true)
    setAuthError('')
    setAuthNotice('')

    const { error: signUpError } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword,
      options: {
        data: {
          full_name: fullName
        }
      }
    })

    if (signUpError) {
      setAuthError(signUpError.message)
      setAuthSubmitting(false)
      return
    }

    setAuthNotice('Account created. If email confirmation is enabled, verify email first, then sign in.')
    setAuthMode('login')
    setAuthConfirmPassword('')
    setAuthSubmitting(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setUserRole('teacher')
    setPinVerified(false)
    setPinCode('')
    setPinError('')
    setShowAdminSetup(false)
    setTeacherList([])
    setSelectedTeacher(null)
    setAdminError('')
    setAdminNotice('')
    setStudents([])
    setError('')
    setSearch('')
    setSelectedClass('all')
  }

  async function handleVerifyPin(event) {
    event.preventDefault()

    if (!pinCode) {
      setPinError('Enter teacher PIN.')
      return
    }

    setPinSubmitting(true)
    setPinError('')

    try {
      const result = await verifyTeacherPin(pinCode)

      if (!result?.ok) {
        setPinError(result?.message || 'PIN verification failed.')
        setPinVerified(false)
      } else {
        setPinVerified(true)
        setShowAdminSetup(false)
        setPinError('')
      }
    } catch (err) {
      setPinError(err.message || 'Unable to verify PIN.')
      setPinVerified(false)
    } finally {
      setPinSubmitting(false)
    }
  }

  async function loadTeachers() {
    setAdminLoading(true)
    setAdminError('')

    try {
      const teachers = await adminSearchTeachers(teacherSearch)
      setTeacherList(teachers)
    } catch (err) {
      setAdminError(err.message || 'Unable to load teachers')
    } finally {
      setAdminLoading(false)
    }
  }

  async function handleAdminSearch(event) {
    event.preventDefault()
    await loadTeachers()
  }

  async function handleSetTeacherPin(event) {
    event.preventDefault()

    if (!selectedTeacher) {
      setAdminError('Select a teacher first.')
      return
    }

    if (!newTeacherPin || newTeacherPin.length < 4) {
      setAdminError('PIN must be at least 4 digits/characters.')
      return
    }

    setAdminError('')
    setAdminNotice('')
    setAdminLoading(true)

    try {
      const validDays = Number(pinValidDays) || 15
      await adminSetTeacherPin(selectedTeacher.teacher_user_id, newTeacherPin, validDays)
      setAdminNotice(`PIN updated for ${selectedTeacher.email}`)
      setNewTeacherPin('')
      await loadTeachers()
    } catch (err) {
      setAdminError(err.message || 'Unable to set teacher PIN')
    } finally {
      setAdminLoading(false)
    }
  }

  async function loadStudents() {
    setLoading(true)
    try {
      const data = await fetchStudents()
      setStudents(data)
      setError('')
    } catch (err) {
      setError(err.message || 'Unable to load students')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.name || !form.rollNo || !form.className) {
      setError('Name, Roll Number, and Class are required.')
      return
    }

    try {
      if (form.id) {
        await updateStudent(form.id, {
          ...form,
          updatedAt: new Date().toISOString()
        })
      } else {
        await addStudent({
          ...form,
          createdAt: new Date().toISOString()
        })
      }
      setForm(initialStudentForm)
      setError('')
      await loadStudents()
    } catch (err) {
      setError(err.message || 'Unable to save student')
    }
  }

  function handleEdit(student) {
    setForm(student)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this student permanently?')) return
    try {
      await deleteStudent(id)
      await loadStudents()
    } catch (err) {
      setError(err.message || 'Unable to delete student')
    }
  }

  const classes = useMemo(() => {
    const set = new Set(students.map((student) => student.className).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [students])

  const filteredStudents = students.filter((student) => {
    const matchesSearch = [student.name, student.rollNo, student.className]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesClass = selectedClass === 'all' || student.className === selectedClass
    return matchesSearch && matchesClass
  })

  const isStudentsTableMissing =
    typeof error === 'string' && error.toLowerCase().includes("could not find the table 'public.students'")

  if (authLoading) {
    return (
      <div className="app-shell auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Teacher Intelligence</p>
          <h1>Checking session...</h1>
        </section>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app-shell auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Teacher Intelligence</p>
          <h1>{authMode === 'login' ? 'Sign in' : 'Create first account'}</h1>
          <p className="intro">
            {authMode === 'login'
              ? 'Login required before accessing the student dashboard.'
              : 'Create initial credentials for admin/teacher access.'}
          </p>

          {authError && <div className="alert error">{authError}</div>}
          {authNotice && <div className="alert success">{authNotice}</div>}

          {authMode === 'login' ? (
            <form className="student-form" onSubmit={handleLogin}>
              <div className="field-group">
                <label>Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="teacher@example.com"
                />
              </div>

              <div className="field-group">
                <label>Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Enter password"
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="button primary" disabled={authSubmitting}>
                  {authSubmitting ? 'Signing in...' : 'Sign in'}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setAuthMode('signup')
                    setAuthError('')
                    setAuthNotice('')
                  }}
                >
                  First-time setup
                </button>
              </div>
            </form>
          ) : (
            <form className="student-form" onSubmit={handleSignUp}>
              <div className="field-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Teacher name"
                />
              </div>

              <div className="field-group">
                <label>Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="teacher@example.com"
                />
              </div>

              <div className="field-grid">
                <div className="field-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="Min 6 characters"
                  />
                </div>
                <div className="field-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={authConfirmPassword}
                    onChange={(event) => setAuthConfirmPassword(event.target.value)}
                    placeholder="Re-enter password"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="button primary" disabled={authSubmitting}>
                  {authSubmitting ? 'Creating account...' : 'Create account'}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setAuthMode('login')
                    setAuthError('')
                    setAuthNotice('')
                  }}
                >
                  Back to sign in
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    )
  }

  if (isAdminRoute) {
    return (
      <div className="app-shell auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Teacher Intelligence</p>
          <h1>Admin Setup</h1>
          <p className="intro">Search teacher and set/renew PIN from this dedicated page.</p>

          {userRole !== 'admin' ? (
            <>
              <div className="alert error">
                This account is not admin. Ask admin to promote your role in user_profiles.
              </div>
              <div className="form-actions">
                <a href="/" className="button secondary" role="button">
                  Back to app
                </a>
                <button type="button" className="button tertiary" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="student-form">
              {adminError && <div className="alert error">{adminError}</div>}
              {adminNotice && <div className="alert success">{adminNotice}</div>}

              <form className="admin-search" onSubmit={handleAdminSearch}>
                <div className="field-group">
                  <label>Search teacher by email/name</label>
                  <input
                    value={teacherSearch}
                    onChange={(event) => setTeacherSearch(event.target.value)}
                    placeholder="teacher@example.com"
                  />
                </div>
                <button type="submit" className="button secondary" disabled={adminLoading}>
                  {adminLoading ? 'Searching...' : 'Search'}
                </button>
              </form>

              <div className="teacher-list">
                {teacherList.map((teacher) => (
                  <button
                    key={teacher.teacher_user_id}
                    type="button"
                    className={`teacher-row ${selectedTeacher?.teacher_user_id === teacher.teacher_user_id ? 'active' : ''}`}
                    onClick={() => setSelectedTeacher(teacher)}
                  >
                    <span>{teacher.email}</span>
                    <small>{teacher.full_name || 'No name'} | Expires: {teacher.pin_expires_at || 'Not set'}</small>
                  </button>
                ))}
                {!teacherList.length && <p className="intro">No teachers found yet. Run search to load list.</p>}
              </div>

              <form className="student-form" onSubmit={handleSetTeacherPin}>
                <div className="field-group">
                  <label>New Teacher PIN</label>
                  <input
                    type="password"
                    value={newTeacherPin}
                    onChange={(event) => setNewTeacherPin(event.target.value)}
                    placeholder="Set new PIN"
                  />
                </div>

                <div className="field-group">
                  <label>Validity Days</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={pinValidDays}
                    onChange={(event) => setPinValidDays(event.target.value)}
                  />
                </div>

                <div className="form-actions">
                  <button type="submit" className="button primary" disabled={adminLoading}>
                    Set PIN
                  </button>
                  <a href="/" className="button secondary" role="button">
                    Back to app
                  </a>
                </div>
              </form>
            </div>
          )}
        </section>
      </div>
    )
  }

  if (!pinVerified) {
    return (
      <div className="app-shell auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Teacher Intelligence</p>
          <h1>{showAdminSetup ? 'Admin Setup' : 'App Locked'}</h1>
          <p className="intro">
            {showAdminSetup
              ? 'Search teacher and set a new PIN validity period.'
              : 'Enter teacher PIN to continue to the dashboard.'}
          </p>

          {!showAdminSetup && pinError && <div className="alert error">{pinError}</div>}

          {!showAdminSetup ? (
            <form className="student-form" onSubmit={handleVerifyPin}>
              <div className="field-group">
                <label>Teacher PIN</label>
                <input
                  type="password"
                  value={pinCode}
                  onChange={(event) => setPinCode(event.target.value)}
                  placeholder="Enter PIN"
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="button primary" disabled={pinSubmitting}>
                  {pinSubmitting ? 'Verifying...' : 'Unlock System'}
                </button>
                {userRole === 'admin' && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setShowAdminSetup(true)
                      setAdminError('')
                      setAdminNotice('')
                    }}
                  >
                    Admin Setup
                  </button>
                )}
                <a href="/admin" className="button tertiary" role="button">
                  Admin Page
                </a>
                <button type="button" className="button tertiary" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            </form>
          ) : (
            <div className="student-form">
              {adminError && <div className="alert error">{adminError}</div>}
              {adminNotice && <div className="alert success">{adminNotice}</div>}

              <form className="admin-search" onSubmit={handleAdminSearch}>
                <div className="field-group">
                  <label>Search teacher by email/name</label>
                  <input
                    value={teacherSearch}
                    onChange={(event) => setTeacherSearch(event.target.value)}
                    placeholder="teacher@example.com"
                  />
                </div>
                <button type="submit" className="button secondary" disabled={adminLoading}>
                  {adminLoading ? 'Searching...' : 'Search'}
                </button>
              </form>

              <div className="teacher-list">
                {teacherList.map((teacher) => (
                  <button
                    key={teacher.teacher_user_id}
                    type="button"
                    className={`teacher-row ${selectedTeacher?.teacher_user_id === teacher.teacher_user_id ? 'active' : ''}`}
                    onClick={() => setSelectedTeacher(teacher)}
                  >
                    <span>{teacher.email}</span>
                    <small>{teacher.full_name || 'No name'} | Expires: {teacher.pin_expires_at || 'Not set'}</small>
                  </button>
                ))}
                {!teacherList.length && <p className="intro">No teachers found yet. Try search with empty text.</p>}
              </div>

              <form className="student-form" onSubmit={handleSetTeacherPin}>
                <div className="field-group">
                  <label>New Teacher PIN</label>
                  <input
                    type="password"
                    value={newTeacherPin}
                    onChange={(event) => setNewTeacherPin(event.target.value)}
                    placeholder="Set new PIN"
                  />
                </div>

                <div className="field-group">
                  <label>Validity Days</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={pinValidDays}
                    onChange={(event) => setPinValidDays(event.target.value)}
                  />
                </div>

                <div className="form-actions">
                  <button type="submit" className="button primary" disabled={adminLoading}>
                    Set PIN & Unlock
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setShowAdminSetup(false)
                      setAdminError('')
                      setAdminNotice('')
                    }}
                  >
                    Back to PIN Login
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Teacher Intelligence</p>
          <h1>Student management with Supabase</h1>
          <p className="intro">A modern React dashboard with database-backed student records.</p>
        </div>
        <div className="header-actions">
          <span className="session-email">{session.user.email}</span>
          <button type="button" className="button secondary" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        {isStudentsTableMissing && (
          <section className="panel setup-panel">
            <p className="eyebrow">Database setup</p>
            <h2>Missing students table</h2>
            <p className="intro">
              Auth is now working. Next step: create the students table in Supabase SQL Editor, then refresh this page.
            </p>
          </section>
        )}

        <section className="panel panel-form">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Student record</p>
              <h2>{form.id ? 'Edit student' : 'Add new student'}</h2>
            </div>
            <div>{loading ? 'Loading...' : `${students.length} student(s)`}</div>
          </div>

          {error && <div className="alert error">{error}</div>}

          <form onSubmit={handleSubmit} className="student-form">
            <div className="field-group">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Student name"
              />
            </div>

            <div className="field-grid">
              <div className="field-group">
                <label>Roll Number</label>
                <input
                  value={form.rollNo}
                  onChange={(e) => setForm({ ...form, rollNo: e.target.value })}
                  placeholder="Roll no"
                />
              </div>
              <div className="field-group">
                <label>Class</label>
                <input
                  value={form.className}
                  onChange={(e) => setForm({ ...form, className: e.target.value })}
                  placeholder="e.g. 8A"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field-group">
                <label>Father Name</label>
                <input
                  value={form.fatherName}
                  onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                  placeholder="Father name"
                />
              </div>
              <div className="field-group">
                <label>Mother Name</label>
                <input
                  value={form.motherName}
                  onChange={(e) => setForm({ ...form, motherName: e.target.value })}
                  placeholder="Mother name"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field-group">
                <label>Phone</label>
                <input
                  value={form.parentPhone}
                  onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
                  placeholder="Parent phone"
                />
              </div>
              <div className="field-group">
                <label>Admission No</label>
                <input
                  value={form.admissionNo}
                  onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
                  placeholder="Admission number"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field-group">
                <label>DOB</label>
                <input
                  type="date"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                />
              </div>
              <div className="field-group">
                <label>Blood Group</label>
                <input
                  value={form.bloodGroup}
                  onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
                  placeholder="Blood group"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field-group">
                <label>Aadhar</label>
                <input
                  value={form.aadharNumber}
                  onChange={(e) => setForm({ ...form, aadharNumber: e.target.value })}
                  placeholder="Aadhar number"
                />
              </div>
              <div className="field-group">
                <label>Saral Portal</label>
                <input
                  value={form.saralPortalNumber}
                  onChange={(e) => setForm({ ...form, saralPortalNumber: e.target.value })}
                  placeholder="Saral portal id"
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="button primary">
                {form.id ? 'Update Student' : 'Save Student'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setForm(initialStudentForm)}
              >
                Reset
              </button>
            </div>
          </form>
        </section>

        <section className="panel panel-table">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Student roster</p>
              <h2>Student records</h2>
            </div>
            <div className="filter-row">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, roll, class"
              />
              <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                {classes.map((className) => (
                  <option key={className} value={className}>
                    {className === 'all' ? 'All classes' : className}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roll</th>
                  <th>Class</th>
                  <th>Parent</th>
                  <th>Phone</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr key={student.id}>
                    <td>{student.name}</td>
                    <td>{student.rollNo}</td>
                    <td>{student.className}</td>
                    <td>{student.fatherName || student.motherName || '—'}</td>
                    <td>{student.parentPhone || '—'}</td>
                    <td className="table-actions">
                      <button className="button tertiary" onClick={() => handleEdit(student)}>
                        Edit
                      </button>
                      <button className="button danger" onClick={() => handleDelete(student.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredStudents.length === 0 && (
                  <tr>
                    <td colSpan="6" className="empty-state">
                      No students found. Adjust your filters or add a student.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
