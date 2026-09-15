import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApplyLink } from './apply-link'

describe('ApplyLink', () => {
  it('renders nothing when href is null', () => {
    render(<ApplyLink href={null} label="Apply" unavailableLabel="Not available" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
  })

  it('renders nothing when href is not https (defense in depth)', () => {
    render(<ApplyLink href="http://example.com/apply" label="Apply" unavailableLabel="Not available" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders a safe external link for a valid https href', () => {
    render(<ApplyLink href="https://jobs.smartrecruiters.com/Inetum2/abc/apply" label="Apply" unavailableLabel="Not available" />)
    const link = screen.getByRole('link', { name: 'Apply' })
    expect(link).toHaveAttribute('href', 'https://jobs.smartrecruiters.com/Inetum2/abc/apply')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
