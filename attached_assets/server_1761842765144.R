get_theme <- function(choice) {
  if (choice == "flatly") {
    bs_theme(
      version = 5,
      bootswatch = "flatly",
      primary = "#2B0573",
      secondary = "#AAA0FF" # custom primary for Corporate
    )
  } else {
    bs_theme(
      version = 5,
      bootswatch = choice
    )
  }
}

# Place this near the top of server.R or global.R
theme_colours <- list(
  flatly = list(primary = "#2B0573", secondary = "#AAA0FF"),
  vapor = list(primary = "#24a3f1", secondary = "#E93Ab7"),   # Example vapor palette
  quartz = list(primary = "#FFFFFF", secondary = "#39CBFB")   # Example quartz palette
  # quartz = list(primary = "#FFC107", secondary = "#39CBFB")   # Example quartz palette
)


server <- function(input, output, session) { # Added session as a function
  observe_helpers()
  
  
  # Theme switcher
  observe({
    session$setCurrentTheme(get_theme(input$theme_select))
  })
  
  # Adding in holidays feature
  # --- Holidays state ---
  rv <- reactiveValues(
    periods = data.frame(
      start = as.Date(character()),
      end   = as.Date(character()),
      label = character(),
      stringsAsFactors = FALSE
    )
  )

# --- Helpers for holiday overlays ---
  hex_to_rgba <- function(hex, alpha = 0.10) {
    hex <- gsub("#", "", hex)
    r <- strtoi(substr(hex, 1, 2), 16L)
    g <- strtoi(substr(hex, 3, 4), 16L)
    b <- strtoi(substr(hex, 5, 6), 16L)
    sprintf("rgba(%d,%d,%d,%.3f)", r, g, b, alpha)
  }
  
  add_holiday_overlays <- function(dy) {
    per <- rv$periods
    if (nrow(per) == 0) return(dy)
    
    # Yellow (#FFC107) @ 15% opacity for the box. Same yellow for the line.
    shade <- "rgba(255,193,7,0.15)"
    line  <- "#000000"
    
    for (i in seq_len(nrow(per))) {
      start_chr <- as.character(per$start[i])
      end_chr   <- as.character(per$end[i])
      
      # Draw the box AND a single event label at the START of the period
      dy <- dy %>%
        dyShading(from = start_chr, to = end_chr, color = shade) %>%
        dyEvent(start_chr, label = per$label[i], color = line, labelLoc = "bottom")
    }
    dy
  }
  
  

# Apply new period
observeEvent(input$apply_holiday, {
  rng <- input$new_holiday_range
  lbl <- trimws(input$new_holiday_label %||% "")
  validate(
    need(!is.null(rng) && length(rng) == 2, "Set a start and end date"),
    need(nzchar(lbl), "Add a label")
  )
  start <- as.Date(rng[1]); end <- as.Date(rng[2])
  validate(need(start <= end, "Start must be on or before end"))

  # append; de-dupe exact duplicates
  add <- data.frame(start = start, end = end, label = lbl, stringsAsFactors = FALSE)
  rv$periods <- unique(rbind(rv$periods, add))

  # clear editor
  updateDateRangeInput(session, "new_holiday_range", start = NULL, end = NULL)
  updateTextInput(session, "new_holiday_label", value = "")
})

# Remove chosen period
observeEvent(input$remove_period, {
  idx <- suppressWarnings(as.integer(input$period_to_remove))
  req(!is.na(idx), idx >= 1, idx <= nrow(rv$periods))
  rv$periods <- rv$periods[-idx, , drop = FALSE]
})


# Prophet holidays: single label on first day using lower/upper windows
holidays_df <- reactive({
  if (nrow(rv$periods) == 0) return(NULL)
  transform(
    data.frame(
      holiday = rv$periods$label,
      ds      = rv$periods$start,
      lower_window = 0L,
      upper_window = as.integer(rv$periods$end - rv$periods$start),
      stringsAsFactors = FALSE
    ),
    lower_window = as.integer(lower_window),
    upper_window = as.integer(upper_window)
  )
})

# List applied periods and keep the remove dropdown in sync
output$holiday_list_ui <- renderUI({
  df <- rv$periods
  if (nrow(df) == 0) {
    updateSelectInput(session, "period_to_remove",
                      choices = c("(none)" = ""))
    return(tags$em("No periods applied"))
  }
  items <- sprintf("[%s] %s \u2192 %s", df$label, df$start, df$end)
  updateSelectInput(session, "period_to_remove",
                    choices = setNames(seq_along(items), items))
  tags$ul(style="margin:0 0 8px 18px; padding:0;",
          lapply(items, function(x) tags$li(x)))
})

  
  #Adjusting defualt future periods based on granularity
  observeEvent(input$granularity, {
    updateSliderInput(
      session,
      "future_periods",
      value = if (input$granularity == "day") 2 else 12
    )
  })
  
  # Set up the metric value
  metric <- reactiveVal("Your Metric")  # Default fallback
  
  # # Divergence point validation
  divergence_date <- reactive({
    req(input$projection_mode == "Drift Mode")
    date_val <- as.Date(input$divergence_point, format = "%Y-%m-%d")
    validate(
      need(!is.na(date_val),
           "Please enter a valid date in YYYY-MM-DD format.")
    )
    date_val
  })
  
  #### Adding logic for exposing sample data ####
  # 1) Expose a panelStatus boolean so conditionalPanel can react
  output$panelStatus <- reactive({
    # only TRUE once a file is uploaded
    !is.null(input$uploaded_ts)
  })
  # ensure it’s not suspended when hidden
  outputOptions(output, "panelStatus", suspendWhenHidden = FALSE)
  
  # 2) Read & validate the uploaded CSV, determine monthly or daily granularity and pass to UI.
  uploaded_df <- reactive({
    req(input$uploaded_ts)
    df <- read.csv(input$uploaded_ts$datapath, stringsAsFactors = FALSE, check.names = FALSE)
    
    # Rename columns if needed and store metric
    if (!identical(names(df)[1:2], c("ds", "y"))) {
      original_names <- names(df)
      metric(original_names[2])  # Store metric name
      names(df)[1:2] <- c("ds", "y")
    } else {
      metric("Your Metric")
    }
    
    # Try to parse dates and sort
    df$ds <- as.Date(df$ds)
    df <- df[order(df$ds), ]
    
    # Heuristic: check gap between first two dates
    if (nrow(df) >= 2 && !any(is.na(df$ds[1:2]))) {
      gap <- as.numeric(df$ds[2] - df$ds[1])
      granularity_guess <- if (gap == 1) "day" else "month"
      
      updateRadioButtons(
        session,
        inputId = "granularity",
        selected = granularity_guess
      )
      
      # Optional: set future_periods too
      updateSliderInput(
        session,
        inputId = "future_periods",
        value = if (granularity_guess == "day") 2 else 12
      )
    }
    
    df
  })
  
  data <- reactive({
    req(uploaded_df())
    df <- uploaded_df()
    
    # 2a) required columns
    validate(
      need(all(c("ds","y") %in% names(df)),
           "Error: CSV must contain columns named 'ds' and 'y'")
    )
    
    # 2b) parse dates
    df$ds <- as.Date(df$ds)
    validate(
      need(!any(is.na(df$ds)),
           "Error: Some dates in 'ds' could not be parsed (YYYY-MM-DD)")
    )
    
    # 2c) numeric values
    df$y <- as.numeric(df$y)
    validate(
      need(!any(is.na(df$y)),
           "Error: Some values in 'y' are not numeric")
    )
    
    df
  }) %>% 
    bindCache(input$uploaded_ts$datapath)
  
  model <- reactive({
    waiter_show(id = "prophet_plot", html = waiter_html, color = waiter_color)
    
    # Bringing in holidays
    hdf <- holidays_df()
    
    # Add the capacity
    history <- data()
    history$cap <- input$capacity
    
    # Fit a prophet model
    prophet(
      df = history, 
      growth = input$growth,
      n.changepoints = input$n_changepoints,
      seasonality.mode = input$seasonality_mode,
      changepoint.range = input$changepoint_range,
      yearly.seasonality = input$seasonality,
      weekly.seasonality = input$weekly_seasonality,
      daily.seasonality = FALSE,
      seasonality.prior.scale = input$seasonality_prior_scale,
      changepoint.prior.scale = input$changepoint_prior_scale,
      interval.width = input$interval_width,
      holidays = hdf,
      holidays.prior.scale = input$holidays_prior_scale
    )
  }) %>% 
    bindCache(
      data(), 
      input$capacity,
      input$growth, 
      input$n_changepoints, 
      input$seasonality_mode,
      input$changepoint_range,
      input$seasonality,
      input$weekly_seasonality,
      input$seasonality_prior_scale,
      input$holidays_prior_scale,
      input$changepoint_prior_scale,
      input$interval_width,
      holidays_df(),
      input$holidays_prior_scale
      
    )
  
  forecast <- reactive({
    waiter_show(id = "prophet_plot", html = waiter_html, color = waiter_color)
    
    future <- make_future_dataframe(
      m = model(),
      periods = if (input$granularity == "day") input$future_periods * 30 else input$future_periods,
      freq = input$granularity,
      include_history = input$include_history # always TRUE so we always have the whole timeline
    )
    future$cap <- input$capacity
    
    fc <- predict(model(), future)
    
    # Add Pitch Mode columns ONLY IF NEEDED
    if (!is.null(input$projection_mode) && input$projection_mode == "Pitch Mode") {
      orig <- data()
      fc$ds <- as.POSIXct(fc$ds, tz = "UTC")
      orig$ds <- as.POSIXct(orig$ds, tz = "UTC")
      last_actual_date <- max(orig$ds, na.rm = TRUE)
      
      # Join original y onto forecast to get actuals in one dataframe
      fc_full <- merge(fc, orig[, c("ds", "y")], by = "ds", all.x = TRUE)
      
      # Add pitch_yhat: apply only to future forecast points
      future_idx <- which(fc_full$ds > last_actual_date)
      fc_full$pitch_yhat <- NA_real_
      
      if (length(future_idx) > 0) {
        multiplier <- if (is.null(input$pitch_magnitude)) 1 else input$pitch_magnitude
        multipliers <- seq(1, multiplier, length.out = length(future_idx))
        fc_full$pitch_yhat[future_idx] <- fc_full$yhat[future_idx] * multipliers
      }
      
      # Zero out yhat values in the past if history toggle is off
      if (!is.null(input$include_history) && !input$include_history) {
        history_idx <- which(fc_full$ds <= last_actual_date)
        fc_full$yhat[history_idx] <- NA_real_
        fc_full$yhat_lower[history_idx] <- NA_real_
        fc_full$yhat_upper[history_idx] <- NA_real_
      }
      
      fc <- fc_full  # overwrite `fc` with enhanced version
    }
    
    # >>> Always return fc!
    print(">>> Exiting forecast() reactive. Returning fc with columns:")
    print(names(fc))
    fc
    
  }) %>%
    bindCache(
      model(),
      input$future_periods,
      input$granularity,
      input$projection_mode,
      input$pitch_magnitude,
      input$include_history,
      data()
    )
  
  pitch_stats <- reactive({
    req(input$projection_mode == "Pitch Mode")
    fc <- forecast()
    orig <- data()
    
    last_actual_date <- max(orig$ds, na.rm = TRUE)
    fc$ds <- as.POSIXct(fc$ds, tz = "UTC")
    future_idx <- which(fc$ds > last_actual_date)
    
    expected_sum <- sum(fc$yhat[future_idx], na.rm = TRUE)
    pitched_sum <- sum(fc$pitch_yhat[future_idx], na.rm = TRUE)
    delta <- pitched_sum - expected_sum
    delta_pct <- if (expected_sum == 0) NA else 100 * delta / expected_sum
    
    metric_name <- metric()
    
    setNames(
      c(
        format(round(expected_sum), big.mark = ","),
        format(round(pitched_sum), big.mark = ","),
        format(round(delta), big.mark = ","),
        paste0(round(delta_pct, 1), "%")
      ),
      c(
        paste0("Expected ", metric_name),
        paste0("Pitched ", metric_name),
        paste0("Delta ", metric_name),
        "Delta %"
      )
    )
    
  })
  
  output$pitch_stats_bar <- renderUI({
    stats <- pitch_stats()
    tagList(
      tags$div(
        style = "
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 32px;
        padding: 12px 0 10px 0;
        background: rgba(0,0,0,0.10);
        font-family: inherit;
        font-size: 1.06rem;
         color: var(--bs-secondary);
        font-weight: 600;",
        lapply(seq_along(stats), function(i) {
          tags$div(
            style = "text-align: center; min-width: 90px;",
            tags$div(names(stats)[i], style = "opacity:.8; font-size:.97em; font-weight: 600;"),
            tags$div(stats[i], style = "font-size:1.14em; font-weight: bold;")
          )
        })
      ),
      tags$hr(style="margin:0 0 12px 0; border: none; border-top: 2px solid #76d104; opacity:.22;")
    )
  })
  
  drift_results <- reactive({
    req(input$projection_mode == "Drift Mode", input$divergence_point)
    
    # 1. Load & split
    divergence <- divergence_date()
    orig       <- data() %>% mutate(ds = as.Date(ds))
    last_actual <- max(orig$ds)
    
    #Validate date
    if (divergence >= last_actual) {
      validate(
        need(FALSE,
             sprintf("Divergence Point (%s) must be BEFORE the last date in your data (%s).",
                     as.character(divergence),
                     as.character(last_actual)))
      )
    }

    pre_div    <- filter(orig, ds <= divergence)
    
    # 2. Fit Prophet on pre-divergence
    pre_div$cap <- input$capacity
    hdf <- holidays_df()
    drift_model <- prophet(
      df                 = pre_div,
      growth             = input$growth,
      n.changepoints     = input$n_changepoints,
      seasonality.mode   = input$seasonality_mode,
      changepoint.range  = input$changepoint_range,
      yearly.seasonality = input$seasonality,
      weekly.seasonality = input$weekly_seasonality,
      daily.seasonality  = FALSE,
      seasonality.prior.scale  = input$seasonality_prior_scale,
      changepoint.prior.scale  = input$changepoint_prior_scale,
      interval.width     = input$interval_width,
      holidays           = hdf,
      holidays.prior.scale = input$holidays_prior_scale
    )
    
    # 3. Build future: exactly the recorded post-divergence plus user’s extra
    #    (for daily we treat future_periods*30 days; for monthly just periods)
    periods_recorded <- length(seq(divergence + 1, last_actual, by = input$granularity))
    periods_future   <- if (input$granularity == "day") input$future_periods * 30 else input$future_periods
    total_periods    <- periods_recorded + periods_future
    
    future <- make_future_dataframe(
      m               = drift_model,
      periods         = total_periods,
      freq            = input$granularity,
      include_history = TRUE
    )
    future$cap <- input$capacity
    
    # 4. Predict & merge back
    fc <- predict(drift_model, future) %>% 
      mutate(ds = as.Date(ds))
    full_merged <- full_join(
      orig,
      select(fc, ds, yhat, yhat_lower, yhat_upper),
      by = "ds"
    ) %>% arrange(ds)
    
    full_merged
  })
  
  drift_stats <- reactive({
    req(input$projection_mode == "Drift Mode")
    
    full_merged <- drift_results()
    divergence  <- divergence_date()
    max_ds      <- max(data()$ds)
    
    # only the **recorded** post-divergence window
    recorded <- full_merged %>%
      filter(ds > divergence, ds <= max_ds)
    
    expected_sum <- sum(recorded$yhat, na.rm = TRUE)
    recorded_sum <- sum(recorded$y,   na.rm = TRUE)
    delta        <- recorded_sum - expected_sum
    delta_pct    <- if (expected_sum == 0) NA else 100 * delta / expected_sum
    
    setNames(
      c(
        format(round(expected_sum), big.mark = ","),
        format(round(recorded_sum), big.mark = ","),
        format(round(delta), big.mark = ","),
        paste0(round(delta_pct, 1), "%")
      ),
      c(
        paste0("Expected ", metric()),
        paste0("Recorded ", metric()),
        paste0("Delta ", metric()),
        "Delta %"
      )
    )
  })

  
  output$plot_ui <- renderUI({
    if (is.null(input$uploaded_ts)) {
      tags$div(
        id = "spinner-container",
        spin_orbit()
      )
    } else if (input$projection_mode == "Pitch Mode") {
      tagList(
        uiOutput("pitch_stats_bar"),
        dygraphOutput("prophet_plot", height = "700px")
      )
    } else if (input$projection_mode == "Drift Mode") {
      tagList(
        uiOutput("drift_stats_bar"),
        dygraphOutput("prophet_plot", height = "700px")
      )
    } else {
      dygraphOutput("prophet_plot", height = "800px")
    }
  })
  
  output$drift_stats_bar <- renderUI({
    stats <- drift_stats()
    tags$div(
      style = "
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 32px;
      padding: 12px 0 10px 0;
      background: rgba(0,0,0,0.10);
      font-family: inherit;
      font-size: 1.06rem;
      color: var(--bs-secondary);
      font-weight: 600;",
      lapply(seq_along(stats), function(i) {
        tags$div(
          style = "text-align: center; min-width: 90px;",
          tags$div(names(stats)[i], style = "opacity:.8; font-size:.97em; font-weight: 600;"),
          tags$div(stats[i], style = "font-size:1.14em; font-weight: bold;")
        )
      }),
      tags$hr(style="margin:0 0 12px 0; border: none; border-top: 2px solid #76d104; opacity:.22;")
    )
  })
  
  output$prophet_plot <- renderDygraph({
    # Pull manually referenced theme colours
    col_primary <- theme_colours[[input$theme_select]]$primary
    col_secondary <- theme_colours[[input$theme_select]]$secondary
    
    mode <- input$projection_mode %||% "Projector"
    print(paste(">>> Entered renderDygraph. Mode:", mode))
    fc <- forecast()
    orig <- data()
    print(">>> Called forecast() and data() in renderDygraph.")
    print(paste(">>> fc type:", class(fc)))
    print(paste(">>> orig type:", class(orig)))
    
    if (mode == "Projector") {
      fc$ds   <- as.POSIXct(fc$ds, tz = "UTC")
      orig$ds <- as.POSIXct(orig$ds, tz = "UTC")
      last_actual <- max(orig$ds, na.rm = TRUE)
      
      # Merge actuals + forecast
      fc_full <- merge(
        fc[, c("ds","yhat","yhat_lower","yhat_upper")],
        orig[, c("ds","y")],
        by = "ds", all = TRUE
      )
      
      # Respect the Show History toggle for the Expected series
      if (!isTRUE(input$include_history)) {
        past <- fc_full$ds <= last_actual
        fc_full$yhat[past]        <- NA_real_
        fc_full$yhat_lower[past]  <- NA_real_
        fc_full$yhat_upper[past]  <- NA_real_
      }
      
      xts_data <- xts::xts(
        cbind(
          y        = fc_full$y,
          Standard = fc_full$yhat,
          lower    = fc_full$yhat_lower,
          upper    = fc_full$yhat_upper
        ),
        order.by = fc_full$ds
      )
      
      dy <- dygraph(
        xts_data,
        main = paste(
          "Prophet forecast for",
          if (!is.null(input$uploaded_ts)) input$uploaded_ts$name else "your data"
        )
      ) %>%
        # Actuals: points only
        dySeries("y", label = "Actual",
                 color = col_primary,
                 drawPoints = TRUE, pointSize = 2, strokeWidth = 0) %>%
        # Expected: line + shaded band, no points
        dySeries(c("lower","Standard","upper"), label = "Expected",
                 color = col_secondary,
                 drawPoints = FALSE, pointSize = 0, strokeWidth = 2) %>%
        dyAxis("y", label = metric()) %>%
        dyOptions(
          axisLineColor  = col_primary,
          axisLabelColor = col_primary,
          fillAlpha      = 0.22,
          strokeWidth    = 2,
          pointSize      = 0
        ) %>%
        dyRangeSelector(fillColor = col_secondary, strokeColor = col_primary) %>%
        dyCSS("www/dygraphs.css")
      
      dy <- add_holiday_overlays(dy)
    }
    
    else if (mode == "Pitch Mode") {
      print(">>> In Pitch Mode.")
      print(str(fc))
      print(head(fc))
      show_pitch <- !is.null(fc$pitch_yhat)
      last_actual_date <- max(orig$ds, na.rm = TRUE)
      fc_df <- data.frame(
        ds = fc$ds,
        Standard = fc$yhat,
        Pitched = if (show_pitch) fc$pitch_yhat else NA
      )
      if (!input$include_history) {
        fc_df$Standard[fc$ds <= last_actual_date] <- NA_real_
        if (show_pitch) fc_df$Pitched[fc$ds <= last_actual_date] <- NA_real_
      }
      plot_data_full <- merge(fc_df, orig[, c("ds", "y")], by = "ds", all = TRUE)
      xts_data <- xts::xts(fc[, c("yhat", "pitch_yhat", "y", "yhat_lower", "yhat_upper")], order.by = fc$ds)
      names(xts_data) <- c("Standard", "Pitched", "y", "lower", "upper")
      dy <- dygraph(xts_data, main = paste(
        "Prophet forecast (Pitch Mode) for",
        if (!is.null(input$uploaded_ts)) input$uploaded_ts$name else "your data"
      ))
      dy <- add_holiday_overlays(dy)  # draw box+label first
      
      dy <- dy %>%
        { if (show_pitch) dySeries(., "Pitched", label = "Pitched Forecast", color = "#FFA500", strokePattern = "dashed") else . } %>%
        dySeries("y", label = "Actual", color = col_primary, drawPoints = TRUE, pointSize = 2, strokeWidth = 0) %>%
        dySeries(c("lower", "Standard", "upper"), label = NULL, color = col_secondary) %>%
        dyAxis("y", label = metric()) %>%
        dyOptions(
          axisLineColor = col_primary,
          axisLabelColor = col_primary,
          fillAlpha = 0.2,
          strokeWidth = 2,
          pointSize = 2
        ) %>%
        dyRangeSelector(
          fillColor = col_secondary,
          strokeColor = col_primary
        ) %>%
        dyCSS("www/dygraphs.css")
      
      
    } else if (mode == "Drift Mode") {
      full_merged <- drift_results()
      divergence  <- divergence_date()
      

      xts_data <- xts::xts(
        cbind(
          Recorded = full_merged$y,
          Expected = full_merged$yhat,
          lower    = full_merged$yhat_lower,
          upper    = full_merged$yhat_upper
        ),
        order.by = as.POSIXct(full_merged$ds, tz = "UTC")
      )
      
      dy <- dygraph(xts_data,
                    main = paste0("Drift Mode: Projected vs. Recorded (from ", input$divergence_point, ")")
      )
      dy <- add_holiday_overlays(dy)  # draw box+label first
      
      dy <- dy %>%
        dySeries("Recorded", label = "Recorded",
                 color = col_primary,  # FFA500
                 drawPoints = TRUE, pointSize = 2, strokeWidth = 0
        ) %>%
        dySeries("Expected", label = "Expected",
                 color = col_primary, strokeWidth = 2
        ) %>%
        dySeries(c("lower", "Expected", "upper"),
                 label = NULL, color = col_secondary
        ) %>%
        dyEvent(as.character(input$divergence_point),
                label = "Divergence", color = "#FFA500"  # use primary for event line
        ) %>%
        dyAxis("y", label = metric()) %>%
        dyOptions(
          axisLineColor  = col_primary,
          axisLabelColor = col_primary,
          fillAlpha      = 0.22,
          strokeWidth    = 2,
          pointSize      = 2
        ) %>%
        dyRangeSelector(
          fillColor = col_secondary,
          strokeColor = col_primary
        ) %>%
        dyCSS("www/dygraphs.css")
      
      
    } else {
      print(">>> Unknown mode entered!")
      dy <- NULL
    }
    
    dy <- add_holiday_overlays(dy)
    
    waiter_hide(id = "prophet_plot")
    dy
    
  }) %>%
    bindCache(model(), forecast(), data(), input$include_history, input$projection_mode,
              input$divergence_point)
  
  
  # Coding the export feature
  
  output$dyplot_ready <- reactive({
    !is.null(input$uploaded_ts) && nrow(forecast()) > 0
  })
  outputOptions(output, "dyplot_ready", suspendWhenHidden = FALSE)
  
  
  export_data <- reactive({
    mode <- input$projection_mode %||% "Projector"
    
    if (mode == "Projector") {
      forecast()
    } else if (mode == "Pitch Mode") {
      fc <- forecast()
      if (!is.null(fc$pitch_yhat)) {
        out <- fc[, c("ds", "yhat", "yhat_lower", "yhat_upper", "y", "pitch_yhat")]
        names(out) <- c("Date", "Standard_Forecast", "Lower", "Upper", "Actual", "Pitched_Forecast")
        out
      } else {
        fc
      }
    } else if (mode == "Drift Mode") {
      drift_results()
    } else {
      forecast()
    }
  })
  
  output$export_btn <- downloadHandler(
    filename = function() {
      paste0("chrono-drift-drift_mode-", Sys.Date(), ".csv")
    },
    content = function(file) {
      tryCatch({
        if ((input$projection_mode %||% "Projector") == "Drift Mode") {
          stats <- drift_stats()
          stat_names <- names(stats)
          stat_values <- gsub(",", "", unname(stats))
          header_df <- data.frame(
            c("####################################",
              "CHRONO-DRIFT ASSESSMENT", 
              "DIVERGENCE POINT:", 
              stat_names, 
              "####################################"),
            c("", 
              "",  # <--- add a blank here!
              as.character(input$divergence_point), 
              stat_values, 
              ""),
            stringsAsFactors = FALSE
          )

          write.table(header_df, file, sep = ",", row.names = FALSE, col.names = FALSE, na = "", quote = TRUE)
          write.table(data.frame("", ""), file, sep = ",", row.names = FALSE, col.names = FALSE, na = "", quote = TRUE, append = TRUE)
          write.table(data.frame("", ""), file, sep = ",", row.names = FALSE, col.names = FALSE, na = "", quote = TRUE, append = TRUE)
          
          df_out <- drift_results()
          metric_name <- metric()
          colnames(df_out) <- c("Date", "Recorded", "Expected", "Lower bounds", "Upper bounds")
          df_out$Drift   <- df_out$Recorded - df_out$Expected
          df_out$`Drift %` <- ifelse(is.na(df_out$Expected) | df_out$Expected == 0, NA, 100 * df_out$Drift / df_out$Expected)
          sample_val <- df_out$Recorded[which(!is.na(df_out$Recorded))[1]]
          decimals <- if (is.na(sample_val)) 0 else {
            dec <- sub("^[^.]*\\.?", "", as.character(sample_val))
            nchar(dec)
          }
          rnd <- function(x) round(x, decimals)
          df_out$Recorded      <- rnd(df_out$Recorded)
          df_out$Expected      <- rnd(df_out$Expected)
          df_out$`Lower bounds`<- rnd(df_out$`Lower bounds`)
          df_out$`Upper bounds`<- rnd(df_out$`Upper bounds`)
          df_out$Drift         <- rnd(df_out$Drift)
          df_out$`Drift %`     <- round(df_out$`Drift %`, 1)
          
          # Nullifying pre-divergent drift
          # Ensure dates are Date objects
          df_out$Date <- as.Date(df_out$Date)
          div_point <- as.Date(input$divergence_point)
          
          # Nullify Drift and Drift % for dates <= divergence point
          df_out$Drift[df_out$Date <= div_point] <- NA
          df_out$`Drift %`[df_out$Date <= div_point] <- NA
          
          names(df_out) <- c(
            "Date",
            paste0("Recorded ", metric_name),
            paste0("Expected ", metric_name),
            "Lower bounds",
            "Upper bounds",
            "Drift",
            "Drift %"
          )
          suppressWarnings(write.table(
            df_out, file, sep = ",", row.names = FALSE, na = "", append = TRUE, col.names = TRUE
          ))
        } else {
          write.csv(export_data(), file, row.names = FALSE, na = "")
        }
      }, error = function(e) {
        cat("Download handler error:", conditionMessage(e), "\n")
        stop(e)
      })
    }
  )
  
  
  
}
