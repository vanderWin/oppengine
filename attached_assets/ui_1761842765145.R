theme_names <- bslib::bootswatch_themes(5)
ui <- fluidPage(
  theme = bs_theme(),  # will be set server-side
  tags$head(
    tags$link(rel = "stylesheet", href = "https://fonts.googleapis.com/css2?family=DotGothic16&family=Handjet:wght@100..900&display=swap"),
    tags$style(HTML("
    /* full-screen black background, centered */
    #spinner-container {
      background: rgba(var(--bs-primary-rgb), 0.33);
      margin: 0;
      height: 800px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* keep background of spinner transparent */
    #spinner-container .spinner-box {
      background: transparent !important;
    }

    /* Use Handjet for the main app title */
    .custom-title h1 {
      font-family: 'Handjet', sans-serif !important;
      letter-spacing: 0.05em;
      font-variation-settings: 'wght' 600;
    }
    
    /* Holiday block styling */
    .holiday-row{display:flex;gap:12px;align-items:end;flex-wrap:wrap}
    .holiday-row>div{flex:1;min-width:220px}
    .holiday-actions{display:flex;justify-content:flex-end}
    .btn-icon{padding:6px 10px}
    "))
  ),
  
  
  useWaiter(),
  waiterPreloader(
    html = waiter_html,  # If this spinner HTML uses inline style or CSS var for color
    color = "var(--bs-primary)"
  ),
  
  tags$div(
    class = "custom-title",
    style = "display: flex; align-items: center; justify-content: space-between; padding: 10px 0;",
    
    # Title and logo group
    tags$img(
      src = "chronodrift-logo-v1.gif",
      height = "45px",  # Adjust as needed for your layout
      style = "margin-right: 8px;"
    
      ),
      tags$div(
        style = "display: flex; align-items: center; gap: 16px;",
        tags$h1(
          "CHRONO-DRIFT",
          style = "margin: 0; font-size: 3.25rem;")
    ),
    
    # Theme selector area
    div(
      class = "small-dropdown",
      style = "display: flex; align-items: center; gap: 10px; margin-left: auto; padding-right: 8px; height: 100%;",
      tags$span("Theme", style = "font-size: 1rem; color: var(--bs-primary); line-height: 1.4; display: flex; align-items: center; margin-bottom: 15px;"),
      selectInput(
        inputId = "theme_select",
        label = NULL,
        choices = c("Corporate" = "flatly", "Jazzy" = "vapor", "Try Hard" = "quartz"),
        selected = "flatly",
        width = "130px"
      )
    )
  ),
  
  
  
  
  sidebarLayout(
    sidebarPanel(
      tags$h4("SETTINGS"),
      
      
      # helpText("Ensure you have 2 columns, date and value."),
      fileInput(
        inputId = "uploaded_ts",
        label   = "Upload your time-series CSV",
        accept  = c("text/csv", "text/comma-separated-values,text/plain", ".csv"),
        placeholder = "CSV with date values (YYYY-MM-DD) and numeric values."
      ) %>% helper(content = "uploaded_ts"),
      
      # Inside sidebarPanel, replace the existing Granularity radioButtons with this block:
      tags$div(
        style = "display: flex; justify-content: space-between; gap: 18px; margin-bottom: 12px;",
        
        # Left: Projection Mode
        tags$div(
          style = "flex: 1;",
          radioButtons(
            inputId = "projection_mode",
            label = HTML("<h5 style='margin-top:0;margin-bottom:6px;'>Projection Mode</h5>"),
            choices = c("Projector", "Drift Mode", "Pitch Mode"),
            inline = FALSE,    # vertical stack for clarity
            selected = "Projector"
          ) 
        ),
        
        # Right: Granularity
        tags$div(
          style = "flex: 1;",
          radioButtons(
            inputId = "granularity",
            label = HTML("<h5 style='margin-top:0;margin-bottom:6px;'>Granularity</h5>"),
            choices = c("Days" = "day", "Months" = "month"),
            inline = TRUE,
            selected = "day"
          ) %>% helper(content = "projection_mode_help") # Help file to sit outside of the div
        )
      ),
      
      sliderInput(
        inputId = "future_periods",
        label = "Number of Months to Project:",
        min = 1,
        max = 60,
        value = 12,
      ) %>% helper(content = "future_periods"),
      
      conditionalPanel(
        condition = "input.projection_mode == 'Pitch Mode'",
        div(
          style = "border: 2px solid var(--bs-danger); border-radius: 8px; background: rgba(var(--bs-warning-rgb), 0.10); padding: 16px; margin-bottom: 16px;",
          sliderInput(
            inputId = "pitch_magnitude",
            label = "Projection Multiplier",
            min = -1,
            max = 10,
            value = 1.25,
            step = 0.25
          ) %>% helper(content = "pitch_magnitude_help")
        )
      ),
      
      
      conditionalPanel(
        condition = "input.projection_mode == 'Drift Mode'",
        dateInput(
          inputId   = "divergence_point",
          label     = "Divergence Point:",
          value     = NULL,              # no default
          format    = "yyyy-mm-dd",      # ISO format
          startview = "month",           # calendar starts at month view
          weekstart = 1,                 # weeks start on Monday
          autoclose = TRUE
        ) %>% helper(content = "drift_mode")
      ),
      
      helpText("If you don't want to see a fitted model, disable 'Show History'."),

      checkboxInput(
        inputId = "include_history",
        label = "Show History",
        value = TRUE
      ),
      
      radioButtons(
        inputId = "growth",
        label = "Growth",
        choices = c("Linear" = "linear", "Flat" = "flat", "Logistic" = "logistic"),
        inline = TRUE
      ) %>% helper(content = "growth"),
      
      conditionalPanel(
        condition = "input.growth == 'logistic'",
        numericInput(
          inputId = "capacity",
          label = "Capacity",
          value = 150,
          min = 100,
          step = 5
        )
      ) %>% helper(content = "capacity"),
      
      #Seasonality section
      tags$div(
        style = "margin-bottom: 10px;",
        
        # Header row with helper tooltip
        tags$div(
          style = "display: flex; align-items: center; justify-content: space-between;",
          tags$h5("Seasonality settings", style = "margin: 0;"),
        ),
        
        # Checkbox row
        tags$div(
          style = "display: flex; gap: 12px; margin-top: 6px;",
          
          tags$div(
            style = "flex: 1;",
            checkboxInput(
              inputId = "seasonality",
              label = "Yearly seasonality",
              value = TRUE
            )
          ),
          
          tags$div(
            style = "flex: 1;",
            checkboxInput(
              inputId = "weekly_seasonality",
              label = "Weekly seasonality",
              value = FALSE
            )
          )
        )
      ),
      
      
      radioButtons(
        inputId = "seasonality_mode",
        label = "Seasonality mode",
        choices = c("Additive" = "additive", "Multiplicative" = "multiplicative"),
        inline = TRUE
      ) %>% helper(content = "seasonality_mode"),
      
      # Export button shown only if dyplot is ready
      conditionalPanel(
        condition = "output.dyplot_ready",
        tags$hr(),
        div(
          style = "display: flex; justify-content: center; align-items: center; margin-bottom: 18px;",
          downloadButton(
            outputId = "export_btn",
            label = "Export Results",
            class = "btn-success"
          )
        )
      ),
      
      
      tags$hr(),
      
      checkboxInput(
        inputId = "expert_mode",
        label = "Show Advanced Settings",
        value = FALSE
      ),
      
      conditionalPanel(
        condition = "input.expert_mode",
        
        # New addition of holiday mode
        # --- Holidays (clean layout) ---
        tags$div(
          style = "margin-bottom: 12px;",
          tags$h5("Holidays", style = "margin:0;"),
          
          # Row 1: inputs
          div(class="holiday-row",
              div(
                dateRangeInput(
                  "new_holiday_range", "Holiday period",
                  start = NULL, end = NULL, format = "yyyy-mm-dd"
                )
              ),
              div(
                textInput("new_holiday_label", "Label", value = "", placeholder = "e.g. Black Friday")
              ) %>% helper(content = "holidays")
          ),
          
          # Row 2: apply button aligned right
          div(class="holiday-actions",
              actionButton("apply_holiday", label = NULL, icon = icon("check"),
                           class = "btn-primary btn-icon", title = "Apply period")
          ),
          
          # Applied list + remover
          uiOutput("holiday_list_ui"),
          div(style="display:flex; gap:8px; align-items:center; margin-top:6px;",
              selectInput("period_to_remove", "Remove period", choices = NULL, width = "100%"),
              actionButton("remove_period", "Remove", class = "btn-outline-secondary")
          ),
          
          div(style="margin-top:6px;",
              numericInput("holidays_prior_scale", "Holidays prior scale", 10, step = 1)
          )
        ),
        

        sliderInput("n_changepoints", "Number of changepoints", 1, 100, 25) %>% helper(content = "n_changepoints"),
        sliderInput("changepoint_range", "Changepoint range", 0, 1, 0.8, step = 0.01) %>% helper(content = "changepoint_range"),
        numericInput("seasonality_prior_scale", "Seasonality prior scale", 10, step = 1) %>% helper(content = "seasonality_prior_scale"),
        numericInput("changepoint_prior_scale", "Changepoint prior scale", 0.05, step = 0.01) %>% helper(content = "changepoint_prior_scale"),
        sliderInput("interval_width", "Uncertainty interval width", 0, 1, 0.8, step = 0.01) %>% helper(content = "interval_width")
      )
    ),
    
    mainPanel(
      class = "main-panel no-shadow",
      uiOutput("plot_ui"),
      tags$footer(
        style = "text-align: center; padding: 20px; font-size: 1rem; color: var(--bs-info);",
        HTML(paste0(
          '<a href="https://www.journeyfurther.com/?utm_source=chrono-drift-app&utm_medium=referral&utm_campaign=chrono-drift" target="_blank" style="text-decoration: none; color: var(--bs-primary);">',
          '<img src="logo.svg" height="30" style="vertical-align: middle; margin-right: 10px;">',
          "&copy; ", format(Sys.Date(), "%Y"), " Chrono-Drift is a Journey Further product. All rights reserved."
        ))
      )
    )
  )
)
