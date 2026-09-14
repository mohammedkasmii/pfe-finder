import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LanguageSwitch } from './language-switch'
import { getDictionary } from '@/lib/i18n/get-dictionary'

describe('LanguageSwitch', () => {
  it('exposes both languages as accessible, keyboard-operable buttons', () => {
    render(<LanguageSwitch locale="fr" dictionary={getDictionary('fr')} />)

    const fr = screen.getByRole('button', { name: 'Français' })
    const en = screen.getByRole('button', { name: 'English' })

    expect(fr.tagName).toBe('BUTTON')
    expect(en.tagName).toBe('BUTTON')
    expect(fr).toHaveAttribute('aria-pressed', 'true')
    expect(en).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks English as pressed when English is active', () => {
    render(<LanguageSwitch locale="en" dictionary={getDictionary('en')} />)

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('labels the control for assistive technology', () => {
    render(<LanguageSwitch locale="fr" dictionary={getDictionary('fr')} />)
    expect(screen.getByRole('group', { name: 'Choisir la langue' })).toBeInTheDocument()
  })
})
