/** Un relevé brut de la fenêtre hebdomadaire, tel que l'API l'a rapporté. */
export type Reading = {
  /** % du quota hebdo consommé (0-100). */
  used: number
  /** Fin de la fenêtre de 7 jours, en ms epoch ; null si l'API n'en donne pas. */
  resetsAt: number | null
  /** % de la fenêtre de 5 h consommé, quand l'API en donne un. */
  fiveHour: number | null
  /** La fenêtre hebdo par modèle la plus remplie, quand le compte en a une. */
  otherWeek: { label: string; used: number } | null
  /** Quand ce relevé a été lu, en ms epoch. */
  at: number
}

/** Où en est la semaine : le jour en cours et les repères déjà posés. */
export type Trace = {
  /** Identifie la fenêtre de 7 jours (son resetsAt) ; tout repart à zéro quand elle change. */
  windowKey: string
  /** Pour chaque jour de la fenêtre (0-6), le % hebdo déjà consommé à son début. */
  days: Record<string, number>
  /** Les jours dont le repère de départ est une approximation. */
  partialDays: Record<string, true>
  /** Le dernier relevé vu, pour pouvoir fermer un jour au passage du suivant. */
  lastSeen: { dayIndex: number; used: number; at: number } | null
}

/** Vert = en avance sur le budget, orange = dans le rythme, rouge = trop vite. */
export type Pace = 'ahead' | 'onTrack' | 'behind'

/** Tout ce que la barre affiche. Les montants sont en % du quota hebdomadaire. */
export type Snapshot = {
  /** False quand l'API ne donne pas de date de reset : seul `weekUsed` est fiable. */
  hasWindow: boolean
  /** True quand le reset est passé et qu'aucun relevé de la nouvelle semaine n'est arrivé. */
  isExpired: boolean
  weekUsed: number
  /** Ce qui aurait "dû" être consommé à ce stade de la semaine. */
  weekExpected: number
  weekLeft: number
  todayUsed: number
  /** Budget du jour = ce qui restait ce matin / nombre de jours restants. */
  todayBudget: number
  todayLeft: number
  /** 1 à 7. */
  dayNumber: number
  /** Jours restants dans la fenêtre, aujourd'hui compris. */
  daysLeft: number
  pace: Pace
  /** weekExpected - weekUsed : positif = avance, négatif = retard. */
  delta: number
  /** Jour estimé du zéro, en ms epoch ; null si le quota tient jusqu'au reset. */
  zeroAt: number | null
  /** Fin de la fenêtre, en ms epoch. */
  resetsAt: number
  /** True quand le total du jour est une approximation (suivi commencé en cours de journée). */
  isTodayPartial: boolean
  /** True quand le relevé vient du disque, aucune réponse d'API dans cette session. */
  isStale: boolean
  fiveHour: number | null
  /** La fenêtre hebdo par modèle la plus remplie : elle peut bloquer avant la globale. */
  otherWeek: { label: string; used: number } | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'budget-tokens': {
      snapshot: Shaped<Snapshot | null>
    }
  }
}
