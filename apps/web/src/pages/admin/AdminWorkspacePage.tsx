/* eslint-disable */
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../../lib/api'
import { ChartFactory } from '../../components/charts/ChartFactory'
import { ExportFacade } from '../../lib/ExportFacade'
import './AdminWorkspacePage.css'

type AdminSectionId =
  | 'buses'
  | 'routes'
  | 'stops'
  | 'trips'
  | 'assignments'
  | 'users'
  | 'bookings'
  | 'payments'
  | 'checkins'
  | 'maintenance'
  | 'road-alerts'
  | 'lost-found'
  | 'incidents'
  | 'ratings'
  | 'notifications'

type FieldKind =
  | 'text'
  | 'email'
  | 'password'
  | 'tel'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'file-upload'

type CellKind = 'text' | 'date' | 'datetime' | 'currency' | 'status' | 'boolean' | 'number' | 'rating' | 'link'
type FormValue = string | boolean
type AdminRecord = Record<string, unknown> & { id: string }

interface SelectOption {
  label: string
  value: string
}

interface FormFieldConfig {
  name: string
  label: string
  kind: FieldKind
  required?: boolean
  placeholder?: string
  help?: string
  min?: number
  max?: number
  step?: number
  options?: SelectOption[]
  lookup?: string
  lookupLabel?: string[]
  fullWidth?: boolean
  createOnly?: boolean
  visibleWhen?: {
    field: string
    value: FormValue
  }
}

interface FilterConfig {
  name: string
  label: string
  options: SelectOption[]
}

interface ColumnConfig {
  key: string
  label: string
  kind?: CellKind
  sortable?: boolean
  mobileHidden?: boolean
}

interface ResourceAction {
  id: string
  label: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
  visible?: (record: AdminRecord) => boolean
}

interface ResourceConfig {
  id: AdminSectionId
  title: string
  singular: string
  description: string
  endpoint: string
  searchPlaceholder: string
  columns: ColumnConfig[]
  fields: FormFieldConfig[]
  filters: FilterConfig[]
  canCreate?: boolean
  canEdit?: boolean
  canDelete?: boolean
  createLabel?: string
  actions?: ResourceAction[]
}

interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface ListResult {
  items: AdminRecord[]
  meta: PageMeta
}

interface ToastState {
  tone: 'success' | 'error' | 'info'
  message: string
}

const STATUS_OPTIONS: SelectOption[] = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
]

const BUS_STATUS_OPTIONS: SelectOption[] = [
  ...STATUS_OPTIONS,
  { label: 'Retired', value: 'retired' },
]

const USER_STATUS_OPTIONS: SelectOption[] = [
  { label: 'Pending verification', value: 'pending_verification' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Locked', value: 'locked' },
  { label: 'Inactive', value: 'inactive' },
]

const TRIP_STATUS_OPTIONS: SelectOption[] = [
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Boarding', value: 'boarding' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'Cancelled', value: 'cancelled' },
]

const BOOKING_STATUS_OPTIONS: SelectOption[] = [
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Checked in', value: 'checked_in' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Expired', value: 'expired' },
]

const RESOURCE_CONFIGS: Record<AdminSectionId, ResourceConfig> = {
  buses: {
    id: 'buses',
    title: 'Buses',
    singular: 'bus',
    description: 'Manage fleet identity, capacity, tracking devices, and operating status.',
    endpoint: '/admin/buses',
    searchPlaceholder: 'Search by fleet number or plate…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    columns: [
      { key: 'fleetNumber', label: 'Fleet no.', sortable: true },
      { key: 'registrationNumber', label: 'Registration', sortable: true },
      { key: 'model', label: 'Model', mobileHidden: true },
      { key: 'capacity', label: 'Seats', kind: 'number', sortable: true },
      { key: 'status', label: 'Status', kind: 'status', sortable: true },
      { key: 'lastLocationAt', label: 'Last signal', kind: 'datetime', mobileHidden: true },
    ],
    fields: [
      { name: 'fleetNumber', label: 'Fleet number', kind: 'text', required: true, placeholder: 'BUS-014' },
      { name: 'registrationNumber', label: 'Registration number', kind: 'text', required: true, placeholder: 'DHAKA-METRO-B-00-0000' },
      { name: 'model', label: 'Model', kind: 'text', required: true },
      { name: 'capacity', label: 'Seat capacity', kind: 'number', required: true, min: 1, max: 120 },
      { name: 'status', label: 'Operating status', kind: 'select', required: true, options: BUS_STATUS_OPTIONS, help: 'Use the Maintenance workspace to start or finish fleet downtime.' },
      { name: 'gpsDeviceId', label: 'GPS device ID', kind: 'text', help: 'Optional identifier from the approved tracking provider.' },
      { name: 'notes', label: 'Notes', kind: 'textarea', fullWidth: true },
    ],
    filters: [{ name: 'status', label: 'All statuses', options: [...BUS_STATUS_OPTIONS, { label: 'Under maintenance', value: 'maintenance' }] }],
  },
  routes: {
    id: 'routes',
    title: 'Routes',
    singular: 'route',
    description: 'Define published travel corridors, schedule expectations, and route availability.',
    endpoint: '/admin/routes',
    searchPlaceholder: 'Search by route name, code, or stop…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    columns: [
      { key: 'code', label: 'Code', sortable: true },
      { key: 'name', label: 'Route', sortable: true },
      { key: 'origin', label: 'First stop', mobileHidden: true },
      { key: 'destination', label: 'Last stop', mobileHidden: true },
      { key: 'distanceKm', label: 'Distance (km)', kind: 'number' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'code', label: 'Route code', kind: 'text', required: true, placeholder: 'R-01' },
      { name: 'name', label: 'Route name', kind: 'text', required: true },
      { name: 'distanceKm', label: 'Distance (km)', kind: 'number', required: true, min: 0.1, step: 0.1 },
      { name: 'estimatedDurationMinutes', label: 'Expected duration (minutes)', kind: 'number', required: true, min: 1 },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: STATUS_OPTIONS },
      { name: 'description', label: 'Public description', kind: 'textarea', fullWidth: true },
    ],
    filters: [{ name: 'status', label: 'All statuses', options: STATUS_OPTIONS }],
  },
  stops: {
    id: 'stops',
    title: 'Stops',
    singular: 'stop',
    description: 'Maintain route stop order and coordinates used for maps and ETA calculation.',
    endpoint: '/admin/stops',
    searchPlaceholder: 'Search stop name or code…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    columns: [
      { key: 'code', label: 'Code', sortable: true },
      { key: 'name', label: 'Stop', sortable: true },
      { key: 'route.name', label: 'Route' },
      { key: 'sequence', label: 'Order', kind: 'number' },
      { key: 'latitude', label: 'Latitude', mobileHidden: true },
      { key: 'longitude', label: 'Longitude', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'routeId', label: 'Route', kind: 'select', required: true, lookup: '/admin/routes', lookupLabel: ['code', 'name'] },
      { name: 'code', label: 'Stop code', kind: 'text', required: true },
      { name: 'name', label: 'Stop name', kind: 'text', required: true },
      { name: 'sequence', label: 'Stop order', kind: 'number', required: true, min: 1 },
      { name: 'latitude', label: 'Latitude', kind: 'number', required: true, min: -90, max: 90, step: 0.000001 },
      { name: 'longitude', label: 'Longitude', kind: 'number', required: true, min: -180, max: 180, step: 0.000001 },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: STATUS_OPTIONS },
      { name: 'landmark', label: 'Landmark / boarding note', kind: 'textarea', fullWidth: true },
    ],
    filters: [
      { name: 'status', label: 'All statuses', options: STATUS_OPTIONS },
    ],
  },
  trips: {
    id: 'trips',
    title: 'Trips',
    singular: 'trip',
    description: 'Schedule bus runs, assign drivers, and monitor each trip lifecycle.',
    endpoint: '/admin/trips',
    searchPlaceholder: 'Search trip, bus, route, or driver…',
    canCreate: true,
    canEdit: true,
    columns: [
      { key: 'publicCode|reference', label: 'Trip', sortable: true },
      { key: 'route.name', label: 'Route' },
      { key: 'bus.fleetNumber', label: 'Bus' },
      { key: 'driver.name', label: 'Driver', mobileHidden: true },
      { key: 'scheduledStartAt|scheduledStart', label: 'Departure', kind: 'datetime', sortable: true },
      { key: 'bookedSeats', label: 'Booked', kind: 'number', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'routeId', label: 'Route', kind: 'select', required: true, lookup: '/admin/routes', lookupLabel: ['code', 'name'] },
      { name: 'busId', label: 'Bus', kind: 'select', required: true, lookup: '/admin/buses', lookupLabel: ['fleetNumber', 'registrationNumber'] },
      { name: 'driverId', label: 'Driver', kind: 'select', required: true, lookup: '/admin/users?role=driver&status=active', lookupLabel: ['name', 'email'] },
      { name: 'scheduledStart', label: 'Scheduled departure', kind: 'datetime-local', required: true },
      { name: 'scheduledEnd', label: 'Scheduled arrival', kind: 'datetime-local', required: true },
      { name: 'fare', label: 'Fare', kind: 'number', required: true, min: 0, step: 0.01 },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: TRIP_STATUS_OPTIONS },
      { name: 'notes', label: 'Operations note', kind: 'textarea', fullWidth: true },
    ],
    filters: [
      { name: 'status', label: 'All trip statuses', options: TRIP_STATUS_OPTIONS },
      { name: 'date', label: 'Any departure', options: [{ label: 'Today', value: 'today' }, { label: 'Next 7 days', value: 'next_7_days' }, { label: 'Past trips', value: 'past' }] },
    ],
    actions: [
      { id: 'delay', label: 'Mark delayed', tone: 'warning', visible: (row) => valueMatches(row.status, 'scheduled', 'boarding', 'in_progress') },
      { id: 'cancel', label: 'Cancel trip', tone: 'danger', visible: (row) => !valueMatches(row.status, 'completed', 'cancelled') },
    ],
  },

  assignments: {
    id: 'assignments',
    title: 'Driver assignments',
    singular: 'driver assignment',
    description: 'Authorize verified drivers to use a bus during a defined operating window.',
    endpoint: '/admin/assignments',
    searchPlaceholder: 'Search driver, bus, or route…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    createLabel: 'Assign a bus',
    columns: [
      { key: 'driver.name', label: 'Driver', sortable: true },
      { key: 'bus.fleetNumber', label: 'Bus' },
      { key: 'route.name', label: 'Coverage route', mobileHidden: true },
      { key: 'startsAt', label: 'Starts', kind: 'datetime', sortable: true },
      { key: 'endsAt', label: 'Ends', kind: 'datetime', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'driverId', label: 'Verified driver', kind: 'select', required: true, lookup: '/admin/users?role=driver&status=active', lookupLabel: ['name', 'email'] },
      { name: 'busId', label: 'Active bus', kind: 'select', required: true, lookup: '/admin/buses?status=active', lookupLabel: ['fleetNumber', 'registrationNumber'] },
      { name: 'routeId', label: 'Default coverage route', kind: 'select', required: true, lookup: '/admin/routes?status=active', lookupLabel: ['code', 'name'], help: 'This authorizes the bus. The driver can still define custom pickup and destination points.' },
      { name: 'startsAt', label: 'Assignment starts', kind: 'datetime-local', required: true },
      { name: 'endsAt', label: 'Assignment ends (optional)', kind: 'datetime-local', help: 'Leave blank for an ongoing assignment.' },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: [{ label: 'Scheduled', value: 'scheduled' }, { label: 'Active', value: 'active' }, { label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' }] },
      { name: 'notes', label: 'Operations note', kind: 'textarea', fullWidth: true },
    ],
    filters: [{ name: 'status', label: 'All statuses', options: [{ label: 'Scheduled', value: 'scheduled' }, { label: 'Active', value: 'active' }, { label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' }] }],
  },
  users: {
    id: 'users',
    title: 'Users',
    singular: 'user',
    description: 'Administer student, teacher, driver, conductor, and administrator access.',
    endpoint: '/admin/users',
    searchPlaceholder: 'Search name, email, student ID, or employee ID…',
    canCreate: true,
    canEdit: true,
    columns: [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email', sortable: true },
      { key: 'role', label: 'Role', kind: 'status' },
      { key: 'identifier', label: 'ID', mobileHidden: true },
      { key: 'studentProfile.verificationDocumentUrl', label: 'Document', kind: 'link' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'lastLoginAt', label: 'Last sign-in', kind: 'datetime', mobileHidden: true },
    ],
    fields: [
      { name: 'name', label: 'Full name', kind: 'text', required: true },
      { name: 'email', label: 'Email address', kind: 'email', required: true },
      { name: 'phone', label: 'Phone number (optional)', kind: 'tel' },
      { name: 'avatarUrl', label: 'Profile photo', kind: 'file-upload', help: 'Upload a photo (JPEG, PNG or WebP, max 5 MB). Or paste a URL instead.' },
      { name: 'role', label: 'Role', kind: 'select', required: true, options: [{ label: 'Student', value: 'student' }, { label: 'Driver', value: 'driver' }, { label: 'Administrator', value: 'admin' }] },
      { name: 'identifier', label: 'Student / staff / employee ID', kind: 'text', required: true },
      { name: 'licenseNumber', label: 'Driver license number', kind: 'text', required: true, visibleWhen: { field: 'role', value: 'driver' } },
      { name: 'licenseExpiresAt', label: 'Driver license expiry', kind: 'date', required: true, visibleWhen: { field: 'role', value: 'driver' } },
      { name: 'status', label: 'Account status', kind: 'select', required: true, options: USER_STATUS_OPTIONS },
      { name: 'temporaryPassword', label: 'Temporary password', kind: 'password', required: true, createOnly: true, min: 12, help: 'Use at least 12 characters. The user must change it at first sign-in.' },
    ],
    filters: [
      { name: 'role', label: 'All roles', options: [{ label: 'Students', value: 'student' }, { label: 'Drivers', value: 'driver' }, { label: 'Administrators', value: 'admin' }] },
      { name: 'status', label: 'All statuses', options: USER_STATUS_OPTIONS },
    ],
    actions: [
      { id: 'approve', label: 'Verify & activate', tone: 'success', visible: (row) => valueMatches(row.status, 'pending', 'pending_verification') },
      { id: 'suspend', label: 'Suspend', tone: 'danger', visible: (row) => valueMatches(row.status, 'active') },
    ],
  },
  bookings: {
    id: 'bookings',
    title: 'Bookings',
    singular: 'booking',
    description: 'Audit seat allocations and safely manage booking lifecycle exceptions.',
    endpoint: '/admin/bookings',
    searchPlaceholder: 'Search booking reference, student, trip, or seat…',
    canCreate: true,
    canEdit: true,
    columns: [
      { key: 'bookingNumber|reference', label: 'Booking', sortable: true },
      { key: 'student.user.name|student.name', label: 'Student' },
      { key: 'trip.publicCode|trip.reference', label: 'Trip' },
      { key: 'seatAllocations|seatNumber', label: 'Seat' },
      { key: 'fareAmount|amount', label: 'Amount', kind: 'currency', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'createdAt', label: 'Booked', kind: 'datetime', mobileHidden: true },
    ],
    fields: [
      { name: 'studentId', label: 'Student', kind: 'select', required: true, lookup: '/admin/users?role=student', lookupLabel: ['name', 'identifier'] },
      { name: 'tripId', label: 'Trip', kind: 'select', required: true, lookup: '/admin/trips?status=scheduled', lookupLabel: ['reference', 'scheduledStart'] },
      { name: 'seatNumber', label: 'Seat number', kind: 'text', required: true },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: BOOKING_STATUS_OPTIONS },
      { name: 'adminNote', label: 'Reason / internal note', kind: 'textarea', fullWidth: true },
    ],
    filters: [{ name: 'status', label: 'All booking statuses', options: BOOKING_STATUS_OPTIONS }],
    actions: [{ id: 'cancel', label: 'Cancel booking', tone: 'danger', visible: (row) => valueMatches(row.status, 'pending', 'pending_payment', 'confirmed') }],
  },
  payments: {
    id: 'payments',
    title: 'Payments',
    singular: 'payment',
    description: 'Review verified gateway transactions, receipts, failures, and refunds.',
    endpoint: '/admin/payments',
    searchPlaceholder: 'Search transaction, receipt, or payer…',
    columns: [
      { key: 'paymentNumber|transactionId', label: 'Transaction', sortable: true },
      { key: 'payer.name|user.name', label: 'Payer' },
      { key: 'amount', label: 'Amount', kind: 'currency', sortable: true },
      { key: 'provider|gateway', label: 'Gateway', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'paidAt', label: 'Processed', kind: 'datetime', sortable: true },
    ],
    fields: [],
    filters: [{ name: 'status', label: 'All payment statuses', options: [{ label: 'Pending', value: 'pending' }, { label: 'Successful', value: 'success' }, { label: 'Failed', value: 'failed' }, { label: 'Refunded', value: 'refunded' }] }],
    actions: [{ id: 'refund', label: 'Issue refund', tone: 'danger', visible: (row) => valueMatches(row.status, 'success', 'succeeded') }],
  },
  checkins: {
    id: 'checkins',
    title: 'QR check-ins',
    singular: 'check-in',
    description: 'Audit entry validation, duplicate attempts, and manual boarding exceptions.',
    endpoint: '/admin/checkins',
    searchPlaceholder: 'Search booking, student, trip, or scanner…',
    canCreate: true,
    columns: [
      { key: 'booking.bookingNumber|booking.reference', label: 'Booking' },
      { key: 'booking.student.user.name|student.name', label: 'Passenger' },
      { key: 'trip.publicCode|trip.reference', label: 'Trip' },
      { key: 'result|status', label: 'Result', kind: 'status' },
      { key: 'checkedInAt', label: 'Scanned', kind: 'datetime', sortable: true },
      { key: 'scannedBy.name', label: 'Scanned by', mobileHidden: true },
    ],
    fields: [
      { name: 'bookingId', label: 'Booking', kind: 'select', required: true, lookup: '/admin/bookings?status=confirmed', lookupLabel: ['reference', 'seatNumber'] },
      { name: 'reason', label: 'Manual check-in reason', kind: 'textarea', required: true, fullWidth: true, help: 'Manual entry is audited and should only be used when scanning is unavailable.' },
    ],
    filters: [{ name: 'status', label: 'All scan results', options: [{ label: 'Valid', value: 'valid' }, { label: 'Rejected', value: 'rejected' }, { label: 'Revoked', value: 'revoked' }] }],
    createLabel: 'Manual check-in',
    actions: [{ id: 'revoke', label: 'Revoke', tone: 'danger', visible: (row) => valueMatches(row.status ?? row.result, 'valid', 'accepted') }],
  },
  maintenance: {
    id: 'maintenance',
    title: 'Maintenance',
    singular: 'maintenance record',
    description: 'Schedule fleet downtime and keep affected students informed.',
    endpoint: '/admin/maintenance',
    searchPlaceholder: 'Search bus, reason, or work order…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    columns: [
      { key: 'bus.fleetNumber', label: 'Bus' },
      { key: 'type', label: 'Type', kind: 'status' },
      { key: 'title|reason', label: 'Reason' },
      { key: 'startsAt', label: 'Starts', kind: 'datetime' },
      { key: 'expectedReturnAt|expectedAvailableAt', label: 'Expected back', kind: 'datetime', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'busId', label: 'Bus', kind: 'select', required: true, lookup: '/admin/buses', lookupLabel: ['fleetNumber', 'registrationNumber'] },
      { name: 'type', label: 'Maintenance type', kind: 'select', required: true, options: [{ label: 'Scheduled service', value: 'scheduled' }, { label: 'Repair', value: 'repair' }, { label: 'Inspection', value: 'inspection' }, { label: 'Emergency', value: 'emergency' }] },
      { name: 'reason', label: 'Reason', kind: 'text', required: true },
      { name: 'startsAt', label: 'Starts at', kind: 'datetime-local', required: true },
      { name: 'expectedAvailableAt', label: 'Expected availability', kind: 'datetime-local', required: true },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: [{ label: 'Scheduled', value: 'scheduled' }, { label: 'In progress', value: 'in_progress' }, { label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' }] },
      { name: 'notes', label: 'Workshop notes', kind: 'textarea', fullWidth: true },
    ],
    filters: [{ name: 'status', label: 'All statuses', options: [{ label: 'Scheduled', value: 'scheduled' }, { label: 'In progress', value: 'in_progress' }, { label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' }] }],
    actions: [{ id: 'complete', label: 'Mark complete', tone: 'success', visible: (row) => valueMatches(row.status, 'scheduled', 'in_progress') }],
  },
  'road-alerts': {
    id: 'road-alerts',
    title: 'Road alerts',
    singular: 'road alert',
    description: 'Publish route-specific traffic and safety notices to affected passengers.',
    endpoint: '/admin/road-alerts',
    searchPlaceholder: 'Search alert, location, or route…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    columns: [
      { key: 'title', label: 'Alert', sortable: true },
      { key: 'category', label: 'Category', kind: 'status' },
      { key: 'route.name', label: 'Route' },
      { key: 'severity', label: 'Severity', kind: 'status' },
      { key: 'startsAt', label: 'Active from', kind: 'datetime', mobileHidden: true },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'routeId', label: 'Affected route', kind: 'select', required: true, lookup: '/admin/routes', lookupLabel: ['code', 'name'] },
      { name: 'category', label: 'Category', kind: 'select', required: true, options: [{ label: 'Traffic', value: 'traffic' }, { label: 'Roadblock', value: 'roadblock' }, { label: 'Accident', value: 'accident' }, { label: 'Construction', value: 'construction' }, { label: 'Weather', value: 'weather' }, { label: 'Other', value: 'other' }] },
      { name: 'severity', label: 'Severity', kind: 'select', required: true, options: [{ label: 'Information', value: 'info' }, { label: 'Moderate', value: 'moderate' }, { label: 'Severe', value: 'severe' }, { label: 'Critical', value: 'critical' }] },
      { name: 'title', label: 'Title', kind: 'text', required: true },
      { name: 'location', label: 'Location / segment', kind: 'text', required: true },
      { name: 'startsAt', label: 'Active from', kind: 'datetime-local', required: true },
      { name: 'endsAt', label: 'Expected end', kind: 'datetime-local' },
      { name: 'description', label: 'Passenger message', kind: 'textarea', required: true, fullWidth: true },
      { name: 'notifyAffectedStudents', label: 'Notify affected students now', kind: 'checkbox', fullWidth: true },
    ],
    filters: [
      { name: 'status', label: 'All statuses', options: [{ label: 'Active', value: 'active' }, { label: 'Resolved', value: 'resolved' }, { label: 'Scheduled', value: 'scheduled' }] },
      { name: 'category', label: 'All categories', options: [{ label: 'Traffic', value: 'traffic' }, { label: 'Roadblock', value: 'roadblock' }, { label: 'Accident', value: 'accident' }, { label: 'Construction', value: 'construction' }, { label: 'Weather', value: 'weather' }, { label: 'Other', value: 'other' }] },
    ],
    actions: [{ id: 'resolve', label: 'Resolve alert', tone: 'success', visible: (row) => valueMatches(row.status, 'active') }],
  },
  'lost-found': {
    id: 'lost-found',
    title: 'Lost & found',
    singular: 'item report',
    description: 'Verify reports, manage matches, and document item returns.',
    endpoint: '/admin/lost-found',
    searchPlaceholder: 'Search item, reporter, location, or reference…',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    columns: [
      { key: 'reportNumber|reference', label: 'Report', sortable: true },
      { key: 'type', label: 'Type', kind: 'status' },
      { key: 'title', label: 'Item' },
      { key: 'locationText|location', label: 'Location', mobileHidden: true },
      { key: 'happenedAt|occurredAt', label: 'Date', kind: 'datetime' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    fields: [
      { name: 'type', label: 'Report type', kind: 'select', required: true, options: [{ label: 'Lost item', value: 'lost' }, { label: 'Found item', value: 'found' }] },
      { name: 'reporterId', label: 'Reporter', kind: 'select', required: true, lookup: '/admin/users?role=student', lookupLabel: ['name', 'identifier'] },
      { name: 'title', label: 'Item name', kind: 'text', required: true },
      { name: 'category', label: 'Category', kind: 'select', required: true, options: [{ label: 'Electronics', value: 'electronics' }, { label: 'Identification', value: 'identification' }, { label: 'Bag / clothing', value: 'bag_clothing' }, { label: 'Books', value: 'books' }, { label: 'Keys', value: 'keys' }, { label: 'Other', value: 'other' }] },
      { name: 'location', label: 'Location', kind: 'text', required: true },
      { name: 'occurredAt', label: 'Date and time', kind: 'datetime-local', required: true },
      { name: 'status', label: 'Status', kind: 'select', required: true, options: [{ label: 'Pending verification', value: 'pending' }, { label: 'Verified', value: 'verified' }, { label: 'Potential match', value: 'matched' }, { label: 'Claimed', value: 'claimed' }, { label: 'Closed', value: 'closed' }] },
      { name: 'description', label: 'Description', kind: 'textarea', required: true, fullWidth: true },
    ],
    filters: [
      { name: 'type', label: 'Lost and found', options: [{ label: 'Lost', value: 'lost' }, { label: 'Found', value: 'found' }] },
      { name: 'status', label: 'All statuses', options: [{ label: 'Pending verification', value: 'pending' }, { label: 'Verified', value: 'verified' }, { label: 'Potential match', value: 'matched' }, { label: 'Claimed', value: 'claimed' }, { label: 'Closed', value: 'closed' }] },
    ],
    actions: [{ id: 'verify', label: 'Verify report', tone: 'success', visible: (row) => valueMatches(row.status, 'pending', 'pending_verification') }],
  },
  incidents: {
    id: 'incidents',
    title: 'Driver incidents',
    singular: 'incident',
    description: 'Triage driver emergency and route reports, preserve evidence, and record the operational outcome.',
    endpoint: '/admin/incidents',
    searchPlaceholder: 'Search incident, driver, trip, or description…',
    columns: [
      { key: 'incidentNumber', label: 'Incident', sortable: true },
      { key: 'title', label: 'Summary' },
      { key: 'driver.name', label: 'Driver' },
      { key: 'severity', label: 'Severity', kind: 'status', sortable: true },
      { key: 'status', label: 'Status', kind: 'status', sortable: true },
      { key: 'occurredAt', label: 'Reported', kind: 'datetime', sortable: true, mobileHidden: true },
    ],
    fields: [],
    filters: [
      { name: 'status', label: 'All statuses', options: [{ label: 'Open', value: 'open' }, { label: 'Acknowledged', value: 'acknowledged' }, { label: 'Resolved', value: 'resolved' }, { label: 'Dismissed', value: 'dismissed' }] },
      { name: 'severity', label: 'All severities', options: [{ label: 'Information', value: 'info' }, { label: 'Minor', value: 'minor' }, { label: 'Moderate', value: 'moderate' }, { label: 'Major', value: 'major' }, { label: 'Critical', value: 'critical' }] },
      { name: 'category', label: 'All categories', options: [{ label: 'Emergency', value: 'emergency' }, { label: 'Accident', value: 'accident' }, { label: 'Breakdown', value: 'breakdown' }, { label: 'Traffic', value: 'traffic' }, { label: 'Roadblock', value: 'roadblock' }, { label: 'Weather', value: 'weather' }, { label: 'Medical', value: 'medical' }, { label: 'Security', value: 'security' }, { label: 'Other', value: 'other' }] },
    ],
    actions: [
      { id: 'acknowledge', label: 'Acknowledge', tone: 'warning', visible: (row) => valueMatches(row.status, 'open') },
      { id: 'resolve', label: 'Resolve', tone: 'success', visible: (row) => valueMatches(row.status, 'open', 'acknowledged') },
      { id: 'dismiss', label: 'Dismiss', tone: 'danger', visible: (row) => valueMatches(row.status, 'open', 'acknowledged') },
    ],
  },
  ratings: {
    id: 'ratings',
    title: 'Driver ratings',
    singular: 'rating',
    description: 'Review service feedback and moderate content without changing submitted scores.',
    endpoint: '/admin/ratings',
    searchPlaceholder: 'Search driver, student, trip, or comment…',
    columns: [
      { key: 'driver.user.name|driver.name', label: 'Driver', sortable: true },
      { key: 'student.user.name|student.name', label: 'Student' },
      { key: 'score|rating', label: 'Rating', kind: 'rating', sortable: true },
      { key: 'comment', label: 'Comment' },
      { key: 'status', label: 'Moderation', kind: 'status', mobileHidden: true },
      { key: 'createdAt', label: 'Submitted', kind: 'datetime', mobileHidden: true },
    ],
    fields: [],
    filters: [
      { name: 'rating', label: 'All ratings', options: [{ label: '5 stars', value: '5' }, { label: '4 stars', value: '4' }, { label: '3 stars', value: '3' }, { label: '2 stars', value: '2' }, { label: '1 star', value: '1' }] },
      { name: 'status', label: 'All moderation states', options: [{ label: 'Published', value: 'published' }, { label: 'Flagged', value: 'flagged' }, { label: 'Hidden', value: 'hidden' }] },
    ],
    actions: [{ id: 'hide', label: 'Hide comment', tone: 'warning', visible: (row) => !valueMatches(row.status, 'hidden') && row.isVisible !== false }],
  },
  notifications: {
    id: 'notifications',
    title: 'Notifications',
    singular: 'notification',
    description: 'Send targeted service messages and inspect delivery outcomes.',
    endpoint: '/admin/notifications',
    searchPlaceholder: 'Search title, message, audience, or event…',
    canCreate: true,
    columns: [
      { key: 'title', label: 'Notification', sortable: true },
      { key: 'type', label: 'Type', kind: 'status' },
      { key: 'audience', label: 'Audience' },
      { key: 'deliveredCount', label: 'Delivered', kind: 'number' },
      { key: 'failedCount', label: 'Failed', kind: 'number', mobileHidden: true },
      { key: 'sentAt', label: 'Sent', kind: 'datetime', sortable: true },
    ],
    fields: [
      { name: 'type', label: 'Notification type', kind: 'select', required: true, options: [{ label: 'Service announcement', value: 'announcement' }, { label: 'Delay', value: 'delay' }, { label: 'Cancellation', value: 'cancellation' }, { label: 'Maintenance', value: 'maintenance' }, { label: 'Emergency', value: 'emergency' }] },
      { name: 'audience', label: 'Audience', kind: 'select', required: true, options: [{ label: 'All students', value: 'all_students' }, { label: 'All drivers', value: 'all_drivers' }, { label: 'Route passengers', value: 'route' }, { label: 'Trip passengers', value: 'trip' }] },
      { name: 'routeId', label: 'Route (when applicable)', kind: 'select', lookup: '/admin/routes', lookupLabel: ['code', 'name'] },
      { name: 'tripId', label: 'Trip (when applicable)', kind: 'select', lookup: '/admin/trips?status=scheduled', lookupLabel: ['reference', 'scheduledStart'] },
      { name: 'title', label: 'Title', kind: 'text', required: true },
      { name: 'message', label: 'Message', kind: 'textarea', required: true, fullWidth: true, max: 500, help: 'Keep operational messages concise and action-oriented.' },
      { name: 'sendPush', label: 'Send as push notification', kind: 'checkbox', fullWidth: true },
    ],
    filters: [
      { name: 'type', label: 'All types', options: [{ label: 'Announcement', value: 'announcement' }, { label: 'Delay', value: 'delay' }, { label: 'Cancellation', value: 'cancellation' }, { label: 'Maintenance', value: 'maintenance' }, { label: 'Emergency', value: 'emergency' }] },
      { name: 'delivery', label: 'Any delivery result', options: [{ label: 'Delivered', value: 'delivered' }, { label: 'Partially delivered', value: 'partial' }, { label: 'Failed', value: 'failed' }] },
    ],
    createLabel: 'Send notification',
    actions: [{ id: 'resend', label: 'Resend failures', visible: (row) => Number(row.failedCount ?? 0) > 0 }],
  },
}

const SECTION_GROUPS: Array<{ label: string; items: Array<{ id: 'overview' | 'reports' | AdminSectionId; label: string }> }> = [
  { label: 'Monitor', items: [{ id: 'overview', label: 'Overview' }, { id: 'reports', label: 'Reports' }, { id: 'trips', label: 'Trips' }, { id: 'assignments', label: 'Driver assignments' }, { id: 'incidents', label: 'Incidents' }] },
  { label: 'Network', items: [{ id: 'buses', label: 'Buses' }, { id: 'routes', label: 'Routes' }, { id: 'stops', label: 'Stops' }, { id: 'maintenance', label: 'Maintenance' }, { id: 'road-alerts', label: 'Road alerts' }] },
  { label: 'People & service', items: [{ id: 'bookings', label: 'Bookings' }, { id: 'payments', label: 'Payments' }, { id: 'checkins', label: 'QR check-ins' }] },
  { label: 'Community', items: [{ id: 'lost-found', label: 'Lost & found' }, { id: 'ratings', label: 'Driver ratings' }, { id: 'notifications', label: 'Notifications' }] },
]

const KNOWN_SECTIONS: Set<string> = new Set([...SECTION_GROUPS.flatMap((group) => group.items.map((item) => item.id)), 'users'])
const CURRENCY = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 })
const NUMBER = new Intl.NumberFormat('en-BD')
const DATE = new Intl.DateTimeFormat('en-BD', { day: '2-digit', month: 'short', year: 'numeric' })
const DATETIME = new Intl.DateTimeFormat('en-BD', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getValue(record: Record<string, unknown>, path: string): unknown {
  for (const candidate of path.split('|')) {
    const value = candidate.split('.').reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), record)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function primaryPath(path: string): string {
  return path.split('|')[0] ?? path
}

function firstDefined(record: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = getValue(record, path)
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

function normalizeRecord(value: unknown, index = 0): AdminRecord {
  const record = isObject(value) ? value : { value }
  const id = String(record.id ?? record._id ?? record.uuid ?? `row-${index}`)
  return { ...record, id }
}

function normalizeList(response: unknown, requestedPage: number, requestedPageSize: number): ListResult {
  const root = isObject(response) ? response : {}
  const nestedData = isObject(root.data) ? root.data : undefined
  const container = nestedData ?? root
  const rawItems = Array.isArray(response)
    ? response
    : Array.isArray(container.items)
      ? container.items
      : Array.isArray(container.results)
        ? container.results
        : Array.isArray(root.data)
          ? root.data
          : []
  const metaCandidate = isObject(container.meta)
    ? container.meta
    : isObject(container.pagination)
      ? container.pagination
      : isObject(root.meta)
        ? root.meta
        : {}
  const total = Number(metaCandidate.total ?? container.total ?? rawItems.length)
  const pageSize = Number(metaCandidate.pageSize ?? metaCandidate.limit ?? requestedPageSize)
  const page = Number(metaCandidate.page ?? metaCandidate.currentPage ?? requestedPage)
  const totalPages = Number(metaCandidate.totalPages ?? Math.max(1, Math.ceil(total / Math.max(1, pageSize))))
  return {
    items: rawItems.map(normalizeRecord),
    meta: { page, pageSize, total, totalPages },
  }
}

function formatDate(value: unknown, includeTime: boolean): string {
  if (!value) return '—'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return includeTime ? DATETIME.format(date) : DATE.format(date)
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function valueMatches(value: unknown, ...expected: string[]): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return expected.some((candidate) => normalized === candidate.toLowerCase())
}

function formatCell(value: unknown, kind: CellKind = 'text'): ReactNode {
  if (value === undefined || value === null || value === '') return <span className="admin-muted">—</span>
  if (kind === 'status') {
    const text = String(value)
    return <span className={`admin-pill admin-pill--${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{humanize(text)}</span>
  }
  if (kind === 'date') return formatDate(value, false)
  if (kind === 'datetime') return formatDate(value, true)
  if (kind === 'currency') return CURRENCY.format(Number(value) || 0)
  if (kind === 'number') return NUMBER.format(Number(value) || 0)
  if (kind === 'boolean') return value ? 'Yes' : 'No'
  if (kind === 'rating') {
    const rating = Math.max(0, Math.min(5, Number(value) || 0))
    return <span className="admin-rating" aria-label={`${rating} out of 5 stars`}><span aria-hidden="true">{'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}</span><span>{rating.toFixed(1)}</span></span>
  }
  if (kind === 'link') {
    return <a className="admin-link" href={String(value)} rel="noreferrer" target="_blank">View Document</a>
  }
  if (Array.isArray(value)) return value.map((item) => (isObject(item) ? String(item.name ?? item.label ?? item.id ?? '') : String(item))).filter(Boolean).join(', ') || '—'
  if (isObject(value)) return String(value.name ?? value.label ?? value.reference ?? value.id ?? '—')
  return String(value)
}

function toInputValue(value: unknown, kind: FieldKind): FormValue {
  if (kind === 'checkbox') return Boolean(value)
  if (kind === 'datetime-local' && value) {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      return local.toISOString().slice(0, 16)
    }
  }
  return value === undefined || value === null ? '' : String(value)
}

function initialFormValues(fields: FormFieldConfig[], record?: AdminRecord): Record<string, FormValue> {
  return fields.reduce<Record<string, FormValue>>((values, field) => {
    values[field.name] = toInputValue(record?.[field.name], field.kind)
    return values
  }, {})
}

function isFieldVisible(field: FormFieldConfig, values: Record<string, FormValue>): boolean {
  return !field.visibleWhen || values[field.visibleWhen.field] === field.visibleWhen.value
}

function serializeForm(fields: FormFieldConfig[], values: Record<string, FormValue>, editing: boolean): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((payload, field) => {
    if (editing && field.createOnly) return payload
    if (!isFieldVisible(field, values)) return payload
    const value = values[field.name]
    if (!editing && !field.required && value === '') return payload
    if (field.kind === 'checkbox') payload[field.name] = Boolean(value)
    else if (field.kind === 'number') payload[field.name] = value === '' ? null : Number(value)
    else if (field.kind === 'datetime-local') payload[field.name] = value ? new Date(String(value)).toISOString() : null
    else payload[field.name] = value === '' ? null : value
    return payload
  }, {})
}

// Replaced by ExportFacade

function AdminIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    reports: <><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/></>,
    buses: <><rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 11h16M8 7h8M7 19v2m10-2v2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></>,
    routes: <><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M8.5 17.5c2-2 1-5 3-7s3-1 4.5-3"/></>,
    stops: <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></>,
    trips: <><path d="M3 12h18M16 7l5 5-5 5"/><path d="M8 7 3 12l5 5"/></>,
    assignments: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M8 19v2m8-2v2"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/></>,
    users: <><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8m2 3a6 6 0 0 1 4 6"/></>,
    bookings: <><path d="M4 3h16v18l-4-2-4 2-4-2-4 2V3Z"/><path d="m8 11 2 2 5-5"/></>,
    payments: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h3"/></>,
    checkins: <><path d="M3 9V4a1 1 0 0 1 1-1h5M15 3h5a1 1 0 0 1 1 1v5M21 15v5a1 1 0 0 1-1 1h-5M9 21H4a1 1 0 0 1-1-1v-5"/><path d="m8 12 3 3 5-6"/></>,
    maintenance: <><path d="m14.7 6.3 3-3a4 4 0 0 1-5 5l-8 8a2.1 2.1 0 0 0 3 3l8-8a4 4 0 0 1 5-5l-3 3Z"/></>,
    'road-alerts': <><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/></>,
    'lost-found': <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6m-3-3h6"/></>,
    incidents: <><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/></>,
    ratings: <path d="m12 2 3 6 6.5 1-4.7 4.6 1.1 6.4-5.9-3.1L6.1 20l1.1-6.4L2.5 9 9 8l3-6Z"/>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  }
  return <svg className="admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.overview}</svg>
}

function AdminModal({ title, description, onClose, children, footer }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const headingId = `modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="admin-modal__header">
          <div>
            <h2 id={headingId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="admin-icon-button" type="button" onClick={onClose} aria-label="Close dialog">×</button>
        </header>
        <div className="admin-modal__body">{children}</div>
        {footer && <footer className="admin-modal__footer">{footer}</footer>}
      </section>
    </div>
  )
}

function ResourceFormModal({ config, record, onClose, onSaved }: { config: ResourceConfig; record?: AdminRecord; onClose: () => void; onSaved: (message: string) => void }) {
  const editing = Boolean(record)
  const fields = useMemo(() => config.fields.filter((field) => !(editing && field.createOnly)), [config.fields, editing])
  const [values, setValues] = useState<Record<string, FormValue>>(() => initialFormValues(fields, record))
  const [fileValues, setFileValues] = useState<Record<string, File | null>>({})
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>(() => {
    // Pre-populate previews from existing record URLs
    const previews: Record<string, string> = {}
    fields.filter(f => f.kind === 'file-upload').forEach(f => {
      const existing = record?.[f.name]
      if (typeof existing === 'string' && existing) previews[f.name] = existing
    })
    return previews
  })
  const [lookups, setLookups] = useState<Record<string, SelectOption[]>>({})
  const [lookupLoading, setLookupLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const lookupFields = fields.filter((field) => field.lookup)
    if (!lookupFields.length) return
    let active = true
    setLookupLoading(true)
    Promise.all(lookupFields.map(async (field) => {
      const separator = field.lookup!.includes('?') ? '&' : '?'
      const response = await api.get<unknown>(`${field.lookup}${separator}limit=100`)
      const result = normalizeList(response, 1, 100)
      const options = result.items.map((item) => {
        const labels = (field.lookupLabel ?? ['name']).map((key) => getValue(item, key)).filter((value) => value !== undefined && value !== null && value !== '')
        return { value: item.id, label: labels.map(String).join(' · ') || item.id }
      })
      return [field.name, options] as const
    })).then((entries) => {
      if (active) setLookups(Object.fromEntries(entries))
    }).catch((lookupError: unknown) => {
      if (active) setError(`Some selection options could not be loaded. ${getErrorMessage(lookupError)}`)
    }).finally(() => {
      if (active) setLookupLoading(false)
    })
    return () => { active = false }
  }, [fields])

  const setValue = (name: string, value: FormValue) => setValues((current) => ({ ...current, [name]: value }))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // Upload any pending file-upload fields first
      const uploadedUrls: Record<string, string> = {}
      for (const field of fields) {
        if (field.kind !== 'file-upload') continue
        const file = fileValues[field.name]
        if (!file) continue
        const formData = new FormData()
        formData.append('avatar', file)
        const result = await api.post<{ url?: string }>('/admin/users/avatar', formData)
        if (result?.url) uploadedUrls[field.name] = result.url
      }
      const payload = { ...serializeForm(fields.filter(f => f.kind !== 'file-upload'), values, editing), ...uploadedUrls }
      // Also include file-upload fields that were NOT re-uploaded (keep existing URL)
      fields.filter(f => f.kind === 'file-upload').forEach(f => {
        if (uploadedUrls[f.name]) return // already set above
        const existingUrl = filePreviews[f.name]
        if (existingUrl && !existingUrl.startsWith('blob:')) payload[f.name] = existingUrl
      })
      if (editing && record) await api.patch(`${config.endpoint}/${encodeURIComponent(record.id)}`, payload)
      else await api.post(config.endpoint, payload)
      onSaved(`${humanize(config.singular)} ${editing ? 'updated' : 'created'} successfully.`)
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminModal
      title={`${editing ? 'Edit' : config.createLabel ? config.createLabel : 'Add'} ${config.createLabel ? '' : config.singular}`.trim()}
      description={editing ? `Update this ${config.singular}. Changes are recorded in the admin audit log.` : `Enter the details for the new ${config.singular}.`}
      onClose={onClose}
      footer={<><button className="admin-button admin-button--ghost" type="button" onClick={onClose} disabled={submitting}>Cancel</button><button className="admin-button admin-button--primary" type="submit" form="admin-resource-form" disabled={submitting || lookupLoading}>{submitting ? 'Saving…' : editing ? 'Save changes' : config.createLabel ?? `Add ${config.singular}`}</button></>}
    >
      <form id="admin-resource-form" className="admin-form-grid" onSubmit={handleSubmit}>
        {error && <div className="admin-alert admin-alert--error admin-form-grid__full" role="alert">{error}</div>}
        {fields.filter((field) => isFieldVisible(field, values)).map((field) => {
          const inputId = `admin-field-${field.name}`
          const value = values[field.name]
          const describedBy = field.help ? `${inputId}-help` : undefined
          const className = field.fullWidth ? 'admin-field admin-form-grid__full' : 'admin-field'
          if (field.kind === 'checkbox') {
            return <label className={`${className} admin-checkbox-field`} key={field.name}><input type="checkbox" checked={Boolean(value)} onChange={(event) => setValue(field.name, event.target.checked)} /><span><strong>{field.label}</strong>{field.help && <small id={describedBy}>{field.help}</small>}</span></label>
          }
          if (field.kind === 'file-upload') {
            const preview = filePreviews[field.name]
            const fieldKey = field.name
            return (
              <div className="admin-form-grid__full" key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 750, color: 'var(--admin-label, #3a4a47)' }}>{field.label}</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    padding: '16px 20px',
                    border: `2px dashed var(--admin-border)`,
                    borderRadius: '14px',
                    background: 'var(--admin-surface-raised, #f5f5f4)',
                    transition: 'border-color 0.2s, background 0.2s',
                    cursor: 'pointer',
                  }}
                  onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--admin-accent, #0f6657)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(15,102,87,0.04)'; }}
                  onDragLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--admin-border)'; (e.currentTarget as HTMLDivElement).style.background = 'var(--admin-surface-raised, #f5f5f4)'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--admin-border)';
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--admin-surface-raised, #f5f5f4)';
                    const file = e.dataTransfer.files?.[0];
                    if (!file || !file.type.startsWith('image/')) return;
                    setFileValues(p => ({ ...p, [fieldKey]: file }));
                    setFilePreviews(p => ({ ...p, [fieldKey]: URL.createObjectURL(file) }));
                  }}
                  onClick={() => document.getElementById(`admin-field-${field.name}`)?.click()}
                >
                  {/* Avatar circle */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{
                      width: 80, height: 80, borderRadius: '50%',
                      background: preview ? 'transparent' : 'linear-gradient(135deg, #e0eeeb 0%, #c8dfd9 100%)',
                      border: preview ? '3px solid var(--admin-accent, #0f6657)' : '2px dashed #b0c8c3',
                      overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: preview ? '0 4px 16px rgba(15,102,87,0.18)' : 'none',
                      transition: 'all 0.25s',
                    }}>
                      {preview
                        ? <img src={preview} alt="Avatar preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8ab4ac" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                      }
                    </div>
                    {/* Camera badge */}
                    <div style={{
                      position: 'absolute', bottom: 0, right: 0,
                      width: 24, height: 24, borderRadius: '50%',
                      background: 'var(--admin-accent, #0f6657)', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid white',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </div>
                  </div>

                  {/* Text instructions */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 3px', fontWeight: 700, fontSize: '0.82rem', color: 'var(--admin-ink, #1a2e2a)' }}>
                      {preview ? 'Photo selected' : 'Upload profile photo'}
                    </p>
                    <p style={{ margin: '0 0 10px', fontSize: '0.71rem', color: 'var(--admin-muted, #6b8480)' }}>
                      {preview ? 'Click or drag a new image to replace it.' : 'Drag & drop here, or click to browse your device.'}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        padding: '5px 11px', borderRadius: '6px',
                        background: 'var(--admin-accent, #0f6657)', color: 'white',
                        fontSize: '0.68rem', fontWeight: 750, cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(15,102,87,0.25)',
                      }} onClick={(e) => { e.stopPropagation(); document.getElementById(`admin-field-${field.name}`)?.click(); }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        {preview ? 'Change photo' : 'Choose file'}
                      </span>
                      {preview && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '5px 11px', borderRadius: '6px',
                          background: 'transparent', color: 'var(--admin-danger, #c0392b)',
                          border: '1px solid rgba(192,57,43,0.3)',
                          fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer',
                        }} onClick={(e) => {
                          e.stopPropagation();
                          setFilePreviews(p => ({ ...p, [fieldKey]: '' }));
                          setFileValues(p => ({ ...p, [fieldKey]: null }));
                        }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                          Remove
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Accepted formats badge */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    {['JPG', 'PNG', 'WebP'].map(fmt => (
                      <span key={fmt} style={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: '4px', background: 'var(--admin-border-soft, #e8edeb)', color: 'var(--admin-muted, #6b8480)' }}>{fmt}</span>
                    ))}
                  </div>
                </div>

                <input
                  id={`admin-field-${field.name}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    setFileValues(p => ({ ...p, [fieldKey]: file }))
                    setFilePreviews(p => ({ ...p, [fieldKey]: URL.createObjectURL(file) }))
                  }}
                />
                {field.help && <small style={{ color: 'var(--admin-muted)', fontSize: '0.65rem' }}>{field.help}</small>}
              </div>
            )
          }
          return (
            <div className={className} key={field.name}>
              <label htmlFor={inputId}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>
              {field.kind === 'textarea' ? (
                <textarea id={inputId} value={String(value ?? '')} onChange={(event) => setValue(field.name, event.target.value)} required={field.required} placeholder={field.placeholder} maxLength={field.max} rows={4} aria-describedby={describedBy} />
              ) : field.kind === 'select' ? (
                <select id={inputId} value={String(value ?? '')} onChange={(event) => setValue(field.name, event.target.value)} required={field.required} aria-describedby={describedBy}>
                  <option value="">Select {field.label.toLowerCase()}</option>
                  {[...(field.options ?? []), ...(lookups[field.name] ?? [])].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input id={inputId} type={field.kind} value={String(value ?? '')} onChange={(event) => setValue(field.name, event.target.value)} required={field.required} placeholder={field.placeholder} min={field.kind === 'number' ? field.min : undefined} minLength={field.kind === 'password' ? field.min : undefined} max={field.kind === 'number' || field.kind === 'date' || field.kind === 'datetime-local' ? field.max : undefined} maxLength={field.kind === 'password' || field.kind === 'text' ? field.max : undefined} step={field.step} autoComplete={field.kind === 'password' ? 'new-password' : undefined} aria-describedby={describedBy} />
              )}
              {field.help && <small id={describedBy}>{field.help}</small>}
            </div>
          )
        })}
      </form>
    </AdminModal>
  )
}

function LostFoundReviewPanel({ record, onChanged, onToast }: { record: AdminRecord; onChanged: () => Promise<void>; onToast: (toast: ToastState) => void }) {
  const claims = (Array.isArray(record.claims) ? record.claims : []).filter(isObject)
  const rawMatches = [
    ...(Array.isArray(record.lostMatches) ? record.lostMatches : []),
    ...(Array.isArray(record.foundMatches) ? record.foundMatches : []),
  ].filter(isObject)
  const matches = [...new Map(rawMatches.map((match) => [String(match.id), match])).values()]
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reviewClaim = async (claim: Record<string, unknown>, status: 'approved' | 'rejected') => {
    const notes = window.prompt(`${humanize(status)} claim: enter review notes for the claimant.`)
    if (notes === null) return
    if (notes.trim().length < 3) {
      setError('Review notes must contain at least 3 characters.')
      return
    }
    setBusy(String(claim.id))
    setError(null)
    try {
      await api.patch(`/lost-found/claims/${encodeURIComponent(String(claim.id))}`, { status, reviewNotes: notes.trim() })
      onToast({ tone: 'success', message: `Claim ${status}.` })
      await onChanged()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const reviewMatch = async (match: Record<string, unknown>, status: 'confirmed' | 'rejected' | 'resolved') => {
    if (!window.confirm(`${humanize(status)} this potential match?`)) return
    setBusy(String(match.id))
    setError(null)
    try {
      await api.patch(`/lost-found/matches/${encodeURIComponent(String(match.id))}`, { status })
      onToast({ tone: 'success', message: `Potential match ${status}.` })
      await onChanged()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  if (!claims.length && !matches.length) return <div className="admin-review-panel"><h3>Claims and potential matches</h3><p className="admin-muted">No claims or potential matches have been submitted for this report.</p></div>
  return (
    <section className="admin-review-panel" aria-labelledby="lost-found-review-title">
      <h3 id="lost-found-review-title">Claims and potential matches</h3>
      {error && <div className="admin-alert admin-alert--error" role="alert">{error}</div>}
      {claims.map((claim) => <article className="admin-review-card" key={String(claim.id)}>
        <div><strong>{String(getValue(claim, 'claimant.name') ?? 'Claimant')}</strong>{formatCell(claim.status, 'status')}</div>
        <p>{String(claim.ownershipProof ?? claim.evidence ?? 'No ownership evidence supplied.')}</p>
        {valueMatches(claim.status, 'pending') && <div className="admin-review-card__actions"><button className="admin-button admin-button--primary" type="button" disabled={busy === String(claim.id)} onClick={() => void reviewClaim(claim, 'approved')}>Approve claim</button><button className="admin-button admin-button--secondary" type="button" disabled={busy === String(claim.id)} onClick={() => void reviewClaim(claim, 'rejected')}>Reject claim</button></div>}
      </article>)}
      {matches.map((match) => <article className="admin-review-card" key={String(match.id)}>
        <div><strong>{String(firstDefined(match, ['foundReport.title', 'lostReport.title']) ?? 'Potential item match')}</strong>{formatCell(match.status, 'status')}</div>
        <p>Confidence: {Math.round(Number(match.confidence ?? 0) * 100)}%{Array.isArray(match.reasons) ? ` · ${match.reasons.join(', ')}` : ''}</p>
        {valueMatches(match.status, 'suggested') && <div className="admin-review-card__actions"><button className="admin-button admin-button--primary" type="button" disabled={busy === String(match.id)} onClick={() => void reviewMatch(match, 'confirmed')}>Confirm match</button><button className="admin-button admin-button--secondary" type="button" disabled={busy === String(match.id)} onClick={() => void reviewMatch(match, 'rejected')}>Reject match</button></div>}
        {valueMatches(match.status, 'confirmed') && <div className="admin-review-card__actions"><button className="admin-button admin-button--primary" type="button" disabled={busy === String(match.id)} onClick={() => void reviewMatch(match, 'resolved')}>Mark resolved</button></div>}
      </article>)}
    </section>
  )
}

function RecordDetailsModal({ config, record, onClose, onChanged, onToast }: { config: ResourceConfig; record: AdminRecord; onClose: () => void; onChanged: () => Promise<void>; onToast: (toast: ToastState) => void }) {
  const displayEntries = Object.entries(record).filter(([key]) => !['id', '_id'].includes(key))
  return (
    <AdminModal title={`${humanize(config.singular)} details`} description={`Record ID: ${record.id}`} onClose={onClose} footer={<button className="admin-button admin-button--primary" type="button" onClick={onClose}>Done</button>}>
      <dl className="admin-details-list">
        {displayEntries.map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{isObject(value) || Array.isArray(value) ? <pre>{JSON.stringify(value, null, 2)}</pre> : formatCell(value, key.toLowerCase().includes('at') || key.toLowerCase().includes('date') ? 'datetime' : key.toLowerCase().includes('status') ? 'status' : 'text')}</dd></div>)}
      </dl>
      {config.id === 'lost-found' && <LostFoundReviewPanel record={record} onChanged={onChanged} onToast={onToast} />}
    </AdminModal>
  )
}

function TableSkeleton({ columns }: { columns: number }) {
  return <div className="admin-table-skeleton" aria-label="Loading records">{Array.from({ length: 6 }).map((_, row) => <div className="admin-table-skeleton__row" key={row}>{Array.from({ length: Math.min(columns, 6) }).map((__, cell) => <span key={cell} />)}</div>)}</div>
}

function ResourcePage({ config, onToast }: { config: ResourceConfig; onToast: (toast: ToastState) => void }) {
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<AdminRecord[]>([])
  const [meta, setMeta] = useState<PageMeta>({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    config.filters.forEach(f => {
      const val = searchParams.get(f.name)
      if (val) initial[f.name] = val
    })
    return initial
  })
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formRecord, setFormRecord] = useState<AdminRecord | 'new' | null>(null)
  const [detailRecord, setDetailRecord] = useState<AdminRecord | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    setPage(1)
    setSearchDraft('')
    setSearch('')
    const nextFilters: Record<string, string> = {}
    config.filters.forEach(f => {
      const val = searchParams.get(f.name)
      if (val) nextFilters[f.name] = val
    })
    setFilters(nextFilters)
    setSort(null)
    setFormRecord(null)
    setDetailRecord(null)
  }, [config.id, searchParams])

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
    if (search) params.set('search', search)
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
    if (sort) {
      params.set('sort', sort.key)
      params.set('order', sort.direction)
    }
    try {
      const response = await api.get<unknown>(`${config.endpoint}?${params.toString()}`)
      if (requestId.current !== currentRequest) return
      const result = normalizeList(response, page, pageSize)
      setItems(result.items)
      setMeta(result.meta)
    } catch (loadError) {
      if (requestId.current !== currentRequest) return
      setError(getErrorMessage(loadError))
      setItems([])
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }, [config.endpoint, filters, page, pageSize, search, sort])

  useEffect(() => { void load() }, [load])

  const applySearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchDraft.trim())
  }

  const updateFilter = (name: string, value: string) => {
    setPage(1)
    setFilters((current) => ({ ...current, [name]: value }))
  }

  const toggleSort = (key: string) => {
    setPage(1)
    setSort((current) => current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' })
  }

  const closeAndReload = (message: string) => {
    setFormRecord(null)
    onToast({ tone: 'success', message })
    void load()
  }

  const loadDetail = async (record: AdminRecord) => {
    setBusyRow(record.id)
    try {
      const response = await api.get<unknown>(`${config.endpoint}/${encodeURIComponent(record.id)}`)
      const candidate = isObject(response) && isObject(response.data) ? response.data : response
      setDetailRecord(normalizeRecord(candidate))
    } catch (detailError) {
      onToast({ tone: 'error', message: getErrorMessage(detailError) })
    } finally {
      setBusyRow(null)
    }
  }

  const refreshDetail = async () => {
    if (!detailRecord) return
    const response = await api.get<unknown>(`${config.endpoint}/${encodeURIComponent(detailRecord.id)}`)
    const candidate = isObject(response) && isObject(response.data) ? response.data : response
    setDetailRecord(normalizeRecord(candidate))
    await load()
  }

  const deleteRecord = async (record: AdminRecord) => {
    if (!window.confirm(`Delete this ${config.singular}? This action cannot be undone.`)) return
    setBusyRow(record.id)
    try {
      await api.delete(`${config.endpoint}/${encodeURIComponent(record.id)}`)
      onToast({ tone: 'success', message: `${humanize(config.singular)} deleted.` })
      if (items.length === 1 && page > 1) setPage((current) => current - 1)
      else await load()
    } catch (deleteError) {
      onToast({ tone: 'error', message: getErrorMessage(deleteError) })
    } finally {
      setBusyRow(null)
    }
  }

  const runAction = async (action: ResourceAction, record: AdminRecord) => {
    const confirmations: Record<string, string> = {
      refund: 'Issue a refund for this payment? The payment gateway will be contacted and the action cannot be reversed here.',
      revoke: 'Revoke this check-in? The passenger entry will remain in the audit trail.',
      cancel: `Cancel this ${config.singular}? Affected users will be notified.`,
      approve: 'Verify and activate this account? The user will be allowed to sign in immediately.',
      suspend: 'Suspend this user account? They will be signed out and unable to sign in.',
      hide: 'Hide this rating comment from public views?',
      dismiss: 'Dismiss this incident? A reason will be recorded and the report will be closed.',
    }
    if (confirmations[action.id] && !window.confirm(confirmations[action.id])) return
    setBusyRow(record.id)
    try {
      const encodedId = encodeURIComponent(record.id)
      if (action.id === 'refund') await api.post(`${config.endpoint}/${encodedId}/refund`, { reason: 'Administrator initiated refund' })
      else if (action.id === 'cancel') await api.post(`${config.endpoint}/${encodedId}/cancel`, {})
      else if (action.id === 'revoke') await api.post(`${config.endpoint}/${encodedId}/revoke`, {})
      else if (action.id === 'resend') await api.post(`${config.endpoint}/${encodedId}/resend`, { failedOnly: true })
      else {
        const statusByAction: Record<string, string> = { approve: 'active', delay: 'delayed', suspend: 'suspended', complete: 'completed', resolve: 'resolved', verify: 'verified', hide: 'hidden', acknowledge: 'acknowledged', dismiss: 'dismissed' }
        const payload: Record<string, unknown> = { status: statusByAction[action.id] }
        if (config.id === 'incidents' && (action.id === 'resolve' || action.id === 'dismiss')) {
          const notes = window.prompt(`Enter ${action.id === 'resolve' ? 'resolution' : 'dismissal'} notes.`)
          if (notes === null) return
          if (notes.trim().length < 3) {
            onToast({ tone: 'error', message: 'Resolution notes must contain at least 3 characters.' })
            return
          }
          payload.resolutionNotes = notes.trim()
        }
        await api.patch(`${config.endpoint}/${encodedId}`, payload)
      }
      onToast({ tone: 'success', message: `${action.label} completed.` })
      await load()
    } catch (actionError) {
      onToast({ tone: 'error', message: getErrorMessage(actionError) })
    } finally {
      setBusyRow(null)
    }
  }

  const exportRowsCSV = () => {
    if (!items.length) return
    ExportFacade.exportToCSV(items, config.columns, `${config.id}-${new Date().toISOString().slice(0, 10)}.csv`)
    onToast({ tone: 'info', message: `Exported ${items.length} visible records as CSV.` })
  }

  const exportRowsPDF = () => {
    if (!items.length) return
    ExportFacade.exportToPDF(items, config.columns, `${config.id}-${new Date().toISOString().slice(0, 10)}.pdf`, `${config.title} Report`)
    onToast({ tone: 'info', message: `Exported ${items.length} visible records as PDF.` })
  }

  const firstItem = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1
  const lastItem = Math.min(meta.total, firstItem + items.length - 1)

  return (
    <section className="admin-resource" aria-labelledby="admin-resource-title">
      <header className="admin-page-header">
        <div>
          <div className="admin-eyebrow">Operations</div>
          <h1 id="admin-resource-title">{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <div className="admin-page-header__actions">
          <details className="admin-export-dropdown">
            <summary className="admin-button admin-button--secondary" style={{ cursor: 'pointer', listStyle: 'none' }}><span aria-hidden="true">↓</span> Export</summary>
            <div className="admin-action-menu" style={{ position: 'absolute', right: 0, marginTop: '8px', zIndex: 10 }}>
              <button type="button" onClick={exportRowsCSV} disabled={!items.length || loading}>Export as CSV</button>
              <button type="button" onClick={exportRowsPDF} disabled={!items.length || loading}>Export as PDF</button>
            </div>
          </details>
          {config.canCreate && <button className="admin-button admin-button--primary" type="button" onClick={() => setFormRecord('new')}><span aria-hidden="true">＋</span> {config.createLabel ?? `Add ${config.singular}`}</button>}
        </div>
      </header>

      <div className="admin-panel">
        <div className="admin-toolbar">
          <form className="admin-search" role="search" onSubmit={applySearch}>
            <span className="admin-search__icon" aria-hidden="true">⌕</span>
            <label className="admin-sr-only" htmlFor={`search-${config.id}`}>Search {config.title.toLowerCase()}</label>
            <input id={`search-${config.id}`} type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={config.searchPlaceholder} />
            <button type="submit">Search</button>
          </form>
          <div className="admin-filters" aria-label="Table filters">
            {config.filters.map((filter) => <label key={filter.name}><span className="admin-sr-only">{filter.label}</span><select value={filters[filter.name] ?? ''} onChange={(event) => updateFilter(filter.name, event.target.value)}><option value="">{filter.label}</option>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}
            {(search || Object.values(filters).some(Boolean)) && <button className="admin-link-button" type="button" onClick={() => { setSearch(''); setSearchDraft(''); setFilters({}); setPage(1) }}>Clear filters</button>}
          </div>
        </div>

        {error && <div className="admin-state admin-state--error" role="alert"><div className="admin-state__icon">!</div><div><h2>We couldn’t load {config.title.toLowerCase()}</h2><p>{error}</p><button className="admin-button admin-button--secondary" type="button" onClick={() => void load()}>Try again</button></div></div>}
        {!error && loading && <TableSkeleton columns={config.columns.length} />}
        {!error && !loading && items.length === 0 && <div className="admin-state"><div className="admin-state__icon">⌕</div><div><h2>No {config.title.toLowerCase()} found</h2><p>{search || Object.values(filters).some(Boolean) ? 'Try changing or clearing the current filters.' : `No ${config.singular} records have been added yet.`}</p>{config.canCreate && !search && <button className="admin-button admin-button--primary" type="button" onClick={() => setFormRecord('new')}>{config.createLabel ?? `Add ${config.singular}`}</button>}</div></div>}
        {!error && !loading && items.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr>{config.columns.map((column) => <th key={column.key} className={column.mobileHidden ? 'admin-table__mobile-hidden' : undefined} scope="col">{column.sortable ? <button className="admin-sort-button" type="button" onClick={() => toggleSort(primaryPath(column.key))} aria-label={`Sort by ${column.label}`}>{column.label}<span aria-hidden="true">{sort?.key === primaryPath(column.key) ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button> : column.label}</th>)}<th scope="col" className="admin-table__actions-heading"><span className="admin-sr-only">Actions</span></th></tr></thead>
              <tbody>{items.map((record) => <tr key={record.id}>{config.columns.map((column) => <td key={column.key} className={column.mobileHidden ? 'admin-table__mobile-hidden' : undefined} data-label={column.label}>{formatCell(getValue(record, column.key), column.kind)}</td>)}<td className="admin-row-actions"><details><summary className="admin-icon-button" aria-label={`Actions for ${String(firstDefined(record, ['name', 'reference', 'title', 'fleetNumber']) ?? config.singular)}`}>•••</summary><div className="admin-action-menu"><button type="button" onClick={() => void loadDetail(record)} disabled={busyRow === record.id}>View details</button>{config.canEdit && <button type="button" onClick={() => setFormRecord(record)}>Edit</button>}{config.actions?.filter((action) => !action.visible || action.visible(record)).map((action) => <button key={action.id} type="button" className={action.tone ? `admin-action-menu__${action.tone}` : undefined} onClick={() => void runAction(action, record)} disabled={busyRow === record.id}>{action.label}</button>)}{config.canDelete && <button type="button" className="admin-action-menu__danger" onClick={() => void deleteRecord(record)} disabled={busyRow === record.id}>Delete</button>}</div></details></td></tr>)}</tbody>
            </table>
          </div>
        )}

        {!error && !loading && meta.total > 0 && <footer className="admin-pagination"><p>Showing <strong>{firstItem}–{lastItem}</strong> of <strong>{NUMBER.format(meta.total)}</strong></p><div className="admin-pagination__controls"><label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label><button className="admin-icon-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={meta.page <= 1} aria-label="Previous page">‹</button><span>Page {meta.page} of {meta.totalPages}</span><button className="admin-icon-button" type="button" onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))} disabled={meta.page >= meta.totalPages} aria-label="Next page">›</button></div></footer>}
      </div>

      {formRecord && <ResourceFormModal config={config} record={formRecord === 'new' ? undefined : formRecord} onClose={() => setFormRecord(null)} onSaved={closeAndReload} />}
      {detailRecord && <RecordDetailsModal config={config} record={detailRecord} onClose={() => setDetailRecord(null)} onChanged={refreshDetail} onToast={onToast} />}
    </section>
  )
}

interface OverviewMetric {
  key: string
  label: string
  value: number
  kind?: 'currency' | 'number'
  change: number
  hint: string
}

function metricValue(data: Record<string, unknown>, paths: string[]): number {
  return Number(firstDefined(data, paths) ?? 0)
}

function OverviewPage({ navigate }: { navigate: (section: string) => void }) {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState('today')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<unknown>(`/admin/overview?range=${encodeURIComponent(range)}`)
      setData(isObject(response) && isObject(response.data) ? response.data : isObject(response) ? response : {})
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load])

  const metrics: OverviewMetric[] = [
    { key: 'active-buses', label: 'Buses in service', value: metricValue(data, ['metrics.activeBuses', 'activeBuses', 'fleet.active']), change: metricValue(data, ['changes.activeBuses']), hint: 'Currently operating' },
    { key: 'trips', label: 'Trips today', value: metricValue(data, ['metrics.tripsToday', 'tripsToday', 'trips.total']), change: metricValue(data, ['changes.trips']), hint: `${metricValue(data, ['metrics.completedTrips', 'completedTrips', 'trips.completed'])} completed` },
    { key: 'passengers', label: 'Passengers today', value: metricValue(data, ['metrics.passengersToday', 'passengersToday', 'bookings.confirmed']), change: metricValue(data, ['changes.passengers']), hint: `${metricValue(data, ['metrics.checkinsToday', 'checkinsToday'])} checked in` },
    { key: 'revenue', label: 'Revenue today', value: metricValue(data, ['metrics.revenueToday', 'revenueToday', 'payments.revenue']), kind: 'currency', change: metricValue(data, ['changes.revenue']), hint: `${metricValue(data, ['metrics.failedPayments', 'failedPayments'])} failed payments` },
  ]

  const activityRaw = firstDefined(data, ['recentActivity', 'activity'])
  const activities = Array.isArray(activityRaw) ? activityRaw.map(normalizeRecord) : []
  const alertsRaw = firstDefined(data, ['attentionRequired', 'alerts'])
  const alerts = Array.isArray(alertsRaw) ? alertsRaw.map(normalizeRecord) : []
  const fleetActive = metricValue(data, ['fleet.active', 'metrics.activeBuses', 'activeBuses'])
  const fleetMaintenance = metricValue(data, ['fleet.maintenance', 'metrics.busesInMaintenance', 'busesInMaintenance'])
  const fleetInactive = metricValue(data, ['fleet.inactive', 'metrics.inactiveBuses', 'inactiveBuses'])
  const fleetTotal = Math.max(1, fleetActive + fleetMaintenance + fleetInactive)

  return (
    <section className="admin-overview" aria-labelledby="admin-overview-title">
      <header className="admin-page-header">
        <div><div className="admin-eyebrow">Command centre</div><h1 id="admin-overview-title">Good day, Admin</h1><p>Here’s what is happening across university transport right now.</p></div>
        <div className="admin-page-header__actions"><label className="admin-range-select"><span className="admin-sr-only">Overview time range</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label><button className="admin-button admin-button--secondary" type="button" onClick={() => void load()} disabled={loading}>↻ Refresh</button></div>
      </header>
      {error && <div className="admin-alert admin-alert--error" role="alert">{error} <button type="button" onClick={() => void load()}>Try again</button></div>}
      <div className="admin-metric-grid">
        {metrics.map((metric) => <article className="admin-metric-card" key={metric.key}><div className="admin-metric-card__top"><span>{metric.label}</span><span className="admin-metric-card__glyph" aria-hidden="true">{metric.key === 'revenue' ? '৳' : metric.key === 'trips' ? '↗' : metric.key === 'passengers' ? '♙' : '▤'}</span></div>{loading ? <span className="admin-skeleton admin-skeleton--metric" /> : <strong>{metric.kind === 'currency' ? CURRENCY.format(metric.value) : NUMBER.format(metric.value)}</strong>}<div className="admin-metric-card__footer"><span className={metric.change > 0 ? 'admin-trend admin-trend--up' : metric.change < 0 ? 'admin-trend admin-trend--down' : 'admin-trend'}>{metric.change ? `${metric.change > 0 ? '↑' : '↓'} ${Math.abs(metric.change)}%` : '—'}</span><small>{metric.hint}</small></div></article>)}
      </div>
      <div className="admin-overview-grid">
        <article className="admin-panel admin-overview-grid__wide">
          <header className="admin-panel__header"><div><h2>Live operations</h2><p>Fleet distribution and items needing attention.</p></div><button className="admin-link-button" type="button" onClick={() => navigate('trips')}>View all trips →</button></header>
          <div className="admin-fleet-summary">
            <div style={{ width: 140, height: 140, marginRight: 24, position: 'relative' }}>
              {ChartFactory.createChart('pie', [
                { label: 'In service', value: fleetActive },
                { label: 'Maintenance', value: fleetMaintenance },
                { label: 'Inactive', value: fleetInactive }
              ], { height: 140, primaryColor: '#2563EB' })}
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <strong style={{ fontSize: '1.25rem' }}>{fleetTotal}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>Buses</span>
              </div>
            </div>
            <dl><div><dt><i className="admin-dot admin-dot--active" />In service</dt><dd>{fleetActive}</dd></div><div><dt><i className="admin-dot admin-dot--maintenance" />Maintenance</dt><dd>{fleetMaintenance}</dd></div><div><dt><i className="admin-dot admin-dot--inactive" />Inactive</dt><dd>{fleetInactive}</dd></div></dl>
          </div>
          <div className="admin-attention-list">{loading ? <TableSkeleton columns={3} /> : alerts.length ? alerts.slice(0, 4).map((alert) => <button type="button" key={alert.id} onClick={() => navigate(String(alert.section ?? 'trips'))}><span className={`admin-attention-list__severity admin-attention-list__severity--${String(alert.severity ?? 'info')}`}>!</span><span><strong>{String(alert.title ?? alert.message ?? 'Operational alert')}</strong><small>{String(alert.description ?? alert.detail ?? '')}</small></span><span aria-hidden="true">›</span></button>) : <div className="admin-inline-empty"><span>✓</span><p><strong>No urgent items</strong><br />Operations are currently within expected thresholds.</p></div>}</div>
        </article>
        <article className="admin-panel">
          <header className="admin-panel__header"><div><h2>Quick actions</h2><p>Common administrative tasks.</p></div></header>
          <div className="admin-quick-actions"><button type="button" onClick={() => navigate('trips')}><span><AdminIcon name="trips" /></span><div><strong>Schedule a trip</strong><small>Assign route, bus, and driver</small></div><b>›</b></button><button type="button" onClick={() => navigate('road-alerts')}><span><AdminIcon name="road-alerts" /></span><div><strong>Publish road alert</strong><small>Notify affected passengers</small></div><b>›</b></button><button type="button" onClick={() => navigate('maintenance')}><span><AdminIcon name="maintenance" /></span><div><strong>Log maintenance</strong><small>Update fleet availability</small></div><b>›</b></button><button type="button" onClick={() => navigate('notifications')}><span><AdminIcon name="notifications" /></span><div><strong>Send announcement</strong><small>Reach a selected audience</small></div><b>›</b></button></div>
        </article>
        <article className="admin-panel admin-overview-grid__full">
          <header className="admin-panel__header"><div><h2>Recent activity</h2><p>Latest events recorded across the platform.</p></div></header>
          {loading ? <TableSkeleton columns={4} /> : activities.length ? <div className="admin-activity-list">{activities.slice(0, 8).map((activity) => <div key={activity.id}><span className="admin-activity-list__icon"><AdminIcon name={String(activity.section ?? 'overview')} /></span><div><strong>{String(activity.title ?? activity.action ?? 'System activity')}</strong><p>{String(activity.description ?? activity.detail ?? '')}</p></div><time dateTime={String(activity.createdAt ?? activity.timestamp ?? '')}>{formatDate(activity.createdAt ?? activity.timestamp, true)}</time></div>)}</div> : <div className="admin-inline-empty"><span>⌁</span><p><strong>No recent activity</strong><br />New operational events will appear here.</p></div>}
        </article>
      </div>
    </section>
  )
}

interface ChartItem {
  label: string
  value: number
}

function normalizeChart(value: unknown): ChartItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => isObject(item) ? { label: String(item.label ?? item.date ?? item.name ?? item.route ?? `Item ${index + 1}`), value: Number(item.value ?? item.total ?? item.amount ?? item.count ?? 0) } : { label: `Item ${index + 1}`, value: Number(item) || 0 })
}

// Replaced by ChartFactory

function ReportsPage({ onToast }: { onToast: (toast: ToastState) => void }) {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [range, setRange] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<unknown>(`/admin/reports?range=${encodeURIComponent(range)}`)
      setData(isObject(response) && isObject(response.data) ? response.data : isObject(response) ? response : {})
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load])
  const revenue = normalizeChart(firstDefined(data, ['revenueTrend', 'charts.revenue', 'revenueByDay']))
  const utilization = normalizeChart(firstDefined(data, ['routeUtilization', 'charts.routeUtilization', 'bookingsByRoute']))
  const onTime = normalizeChart(firstDefined(data, ['onTimePerformance', 'charts.onTime', 'performanceByRoute']))
  const kpis = [
    { label: 'Total revenue', value: metricValue(data, ['summary.revenue', 'totalRevenue']), kind: 'currency' },
    { label: 'Seat utilization', value: metricValue(data, ['summary.seatUtilization', 'seatUtilization']), kind: 'percent' },
    { label: 'On-time trips', value: metricValue(data, ['summary.onTimeRate', 'onTimeRate']), kind: 'percent' },
    { label: 'Average driver rating', value: metricValue(data, ['summary.averageRating', 'averageRating']), kind: 'rating' },
  ]

  const exportReport = (format: 'csv' | 'pdf') => {
    const rawData = kpis.map(kpi => ({ Metric: kpi.label, Value: kpi.value }));
    const columns = [{ key: 'Metric', label: 'Metric' }, { key: 'Value', label: 'Value' }];
    
    if (format === 'csv') {
      ExportFacade.exportToCSV(rawData, columns, `transport-report-${range}-${new Date().toISOString().slice(0, 10)}.csv`)
      onToast({ tone: 'success', message: 'Report exported as CSV.' })
    } else {
      ExportFacade.exportToPDF(rawData, columns, `transport-report-${range}-${new Date().toISOString().slice(0, 10)}.pdf`, `Transport Analytics Report`)
      onToast({ tone: 'success', message: 'Report exported as PDF.' })
    }
  }

  return (
    <section aria-labelledby="admin-reports-title">
      <header className="admin-page-header"><div><div className="admin-eyebrow">Insights</div><h1 id="admin-reports-title">Reports & analytics</h1><p>Track demand, reliability, utilization, and service quality.</p></div>
        <div className="admin-page-header__actions">
          <label className="admin-range-select"><span className="admin-sr-only">Report range</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="12m">Last 12 months</option></select></label>
          <details className="admin-export-dropdown">
            <summary className="admin-button admin-button--primary" style={{ cursor: 'pointer', listStyle: 'none' }}>↓ Export report</summary>
            <div className="admin-action-menu" style={{ position: 'absolute', right: 0, marginTop: '8px', zIndex: 10 }}>
              <button type="button" onClick={() => exportReport('csv')} disabled={loading || Boolean(error)}>Export as CSV</button>
              <button type="button" onClick={() => exportReport('pdf')} disabled={loading || Boolean(error)}>Export as PDF</button>
            </div>
          </details>
        </div>
      </header>
      {error && <div className="admin-alert admin-alert--error" role="alert">{error} <button type="button" onClick={() => void load()}>Try again</button></div>}
      <div className="admin-report-kpis">{kpis.map((kpi) => <article key={kpi.label}><span>{kpi.label}</span>{loading ? <span className="admin-skeleton admin-skeleton--metric" /> : <strong>{kpi.kind === 'currency' ? CURRENCY.format(kpi.value) : kpi.kind === 'percent' ? `${kpi.value.toFixed(1)}%` : `${kpi.value.toFixed(1)} / 5`}</strong>}</article>)}</div>
      <div className="admin-report-grid">
        <article className="admin-panel admin-report-grid__wide"><header className="admin-panel__header"><div><h2>Revenue trend</h2><p>Server-verified successful payments.</p></div></header>{loading ? <TableSkeleton columns={6} /> : ChartFactory.createChart('bar', revenue, { valueKind: 'currency', primaryColor: '#2563EB', height: 260 })}</article>
        <article className="admin-panel"><header className="admin-panel__header"><div><h2>Route utilization</h2><p>Booked seats as a share of available capacity.</p></div></header>{loading ? <TableSkeleton columns={4} /> : ChartFactory.createChart('bar', utilization.slice(0, 8), { valueKind: 'percent', primaryColor: '#4F46E5', height: 260 })}</article>
        <article className="admin-panel admin-report-grid__full"><header className="admin-panel__header"><div><h2>On-time performance by route</h2><p>Trips departing within the configured service threshold.</p></div></header>{loading ? <TableSkeleton columns={6} /> : ChartFactory.createChart('line', onTime, { valueKind: 'percent', primaryColor: '#2563EB', height: 260 })}</article>
      </div>
    </section>
  )
}

export function AdminWorkspacePage() {
  const params = useParams<{ section?: string }>()
  const navigate = useNavigate()
  const rawSection = params.section?.toLowerCase() ?? 'overview'
  const section = KNOWN_SECTIONS.has(rawSection) ? rawSection : 'overview'
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    if (rawSection !== section) navigate('/admin/overview', { replace: true })
  }, [navigate, rawSection, section])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const activeLabel = useMemo(() => SECTION_GROUPS.flatMap((group) => group.items).find((item) => item.id === section)?.label ?? 'Overview', [section])
  const goTo = (nextSection: string) => {
    navigate(`/admin/${nextSection}`)
  }

  return (
    <div className="admin-workspace">
      <nav className="admin-section-nav" aria-label="Administration workspace sections">
        <label className="admin-section-nav__select">
          <span className="admin-sr-only">Current administration section</span>
          <AdminIcon name={section} />
          <select value={section} onChange={(event) => goTo(event.target.value)} aria-label={`Current section: ${activeLabel}`}>
            {SECTION_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
          </select>
        </label>
        <div className="admin-section-nav__links">
          {SECTION_GROUPS.flatMap((group) => group.items).map((item) => <button className={section === item.id ? 'admin-section-nav__active' : undefined} type="button" key={item.id} onClick={() => goTo(item.id)} aria-current={section === item.id ? 'page' : undefined}><AdminIcon name={item.id} /><span>{item.label}</span></button>)}
        </div>
      </nav>
      <div className="admin-main">
        {section === 'overview' ? <OverviewPage navigate={goTo} /> : section === 'reports' ? <ReportsPage onToast={setToast} /> : <ResourcePage config={RESOURCE_CONFIGS[section as AdminSectionId]} onToast={setToast} />}
      </div>
      {toast && <div className={`admin-toast admin-toast--${toast.tone}`} role="status" aria-live="polite"><span aria-hidden="true">{toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i'}</span><p>{toast.message}</p><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
    </div>
  )
}

export default AdminWorkspacePage
