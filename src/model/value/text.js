const ModelValueText = {
  /**
   */
  create () {
    const __store__ = {
      text: '',
      defaultWrapped: '-'
    }

    return {
      /** @type {boolean} */
      loading: true,
      _update () {
        const { loading } = this

        // init
        if (loading) {
          this.loading = false
        }
      },

      /** @type {string} */
      get text () {
        return __store__.text
      },
      set text (val) {
        __store__.text = val

        this._update()
      },

      /** @type {string} */
      get wrapped () {
        const { defaultWrapped } = __store__
        const { text, loading } = this

        return !loading
          ? text
          : defaultWrapped
      }
    }
  }
}

export default ModelValueText
