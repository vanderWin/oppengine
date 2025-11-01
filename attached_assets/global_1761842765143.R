library(shiny)
library(shinyhelper)
library(waiter)
library(bslib)
library(prophet)
library(dygraphs)
library(dplyr)
library(markdown)
# library(shinyWidgets)


# Set cache size, used by bindCache()
shinyOptions(cache = cachem::cache_mem(max_size = 300e6))

# Load dataset choices - deactivated
# ts_choices <- readRDS("data/ts_choices.RDS")

# Define theme for waiter
waiter_html <- spin_orbit()
waiter_color <- "#2B0573"